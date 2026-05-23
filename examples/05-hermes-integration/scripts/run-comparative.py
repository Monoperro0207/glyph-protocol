#!/usr/bin/env python3
"""
Comparative benchmark: same prompt, same model, same underlying tools, two
bridge modes:

  A) eager  — every Glyph card surfaced as an MCP tool (50 schemas every turn)
  B) lazy   — 3 meta-tools (glyph_index, glyph_describe, glyph_invoke); the
              model navigates on demand

The hypothesis (user's claim): B should spend dramatically fewer tokens on
tool descriptions per turn, because cards the agent never touches never enter
context. We measure it. Whatever the number is, we report it honestly.

Single landing-page task. Single prompt. Single model: deepseek-v4-pro.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import requests
import tiktoken

DEEPSEEK_URL = "https://api.deepseek.com/v1/chat/completions"
DEEPSEEK_MODEL = os.environ.get("DEEPSEEK_MODEL", "deepseek-v4-pro")
RESULTS_DIR = Path(__file__).resolve().parent.parent / "results"
RESULTS_DIR.mkdir(exist_ok=True)
MAX_TURNS = int(os.environ.get("MAX_TURNS", "25"))
MAX_BUDGET_USD = float(os.environ.get("MAX_BUDGET_USD", "2.00"))

# Single landing-page prompt — adapted from the PDF's Nickel-style entry.
# Designed to force varied tool use: text manipulation (slugs, titlecase),
# color helpers, hashing (asset cache-busting), html escape, fs.write,
# math.sum (totals), util.uuid (ids). The agent has to pick from ~49 tools.
PROMPT = """\
Build a single-page landing site for "Glyph Protocol" and save it to
/workspace/landing/. It must be one self-contained HTML file with embedded
CSS — no external assets.

Requirements:
  - Hero section with headline "Tool contracts your agent can trust" and a
    subtitle about signed cards and content-addressed updates.
  - Two CTAs: "Install now" (warm orange #f97316 background) and
    "Show me the receipts" (white background, dark text).
  - Three feature cards: "Signed Cards", "Pinning", "Sanitization" — each
    with a one-line description.
  - A small footer with the current ISO-8601 timestamp and a UUID build id.
  - Color palette: off-white background hsl(249 18% 95%), near-black text,
    orange accent #f97316. Generate a lighter shade of the orange for hover
    states using the available tools.
  - Each feature card title must also appear as a URL-safe slug in an HTML
    `id` attribute on its section.
  - Compute a SHA-256 hash of the final HTML body string and embed the first
    8 hex chars as a build hash in the footer.
  - HTML-escape any literal `<` / `>` you include in copy.

Use the tools available. When done, reply with a one-line confirmation that
includes the build hash and uuid you used.
"""


class MCPStdio:
    def __init__(self, cmd: list[str], env: dict[str, str] | None = None) -> None:
        merged_env = {**os.environ, **(env or {})}
        self.proc = subprocess.Popen(
            cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
            env=merged_env,
        )
        self._id = 0

    def _next_id(self) -> int:
        self._id += 1
        return self._id

    def call(self, method: str, params: dict[str, Any] | None = None) -> Any:
        req_id = self._next_id()
        req: dict[str, Any] = {"jsonrpc": "2.0", "id": req_id, "method": method}
        if params is not None:
            req["params"] = params
        assert self.proc.stdin is not None
        self.proc.stdin.write(json.dumps(req) + "\n")
        self.proc.stdin.flush()
        assert self.proc.stdout is not None
        while True:
            line = self.proc.stdout.readline()
            if not line:
                err = (self.proc.stderr.read() if self.proc.stderr else "") or ""
                raise RuntimeError(f"bridge closed stdout: {err}")
            try:
                msg = json.loads(line)
            except json.JSONDecodeError:
                continue
            if msg.get("id") == req_id:
                if "error" in msg:
                    raise RuntimeError(f"mcp error: {msg['error']}")
                return msg.get("result")

    def notify(self, method: str, params: dict[str, Any] | None = None) -> None:
        req: dict[str, Any] = {"jsonrpc": "2.0", "method": method}
        if params is not None:
            req["params"] = params
        assert self.proc.stdin is not None
        self.proc.stdin.write(json.dumps(req) + "\n")
        self.proc.stdin.flush()

    def close(self) -> None:
        try:
            self.proc.stdin.close()  # type: ignore[union-attr]
        except Exception:
            pass
        self.proc.terminate()
        try:
            self.proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            self.proc.kill()


def mcp_tools_to_openai_tools(tools: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "type": "function",
            "function": {
                "name": t["name"],
                "description": t.get("description", ""),
                "parameters": t.get("inputSchema", {"type": "object"}),
            },
        }
        for t in tools
    ]


@dataclass
class TurnUsage:
    turn: int
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int
    tool_calls: list[str] = field(default_factory=list)


@dataclass
class RunResult:
    mode: str
    tools_exposed: int
    listing_tokens: int
    usages: list[TurnUsage]
    final_reply: str
    elapsed_s: float

    @property
    def total_prompt(self) -> int:
        return sum(u.prompt_tokens for u in self.usages)

    @property
    def total_completion(self) -> int:
        return sum(u.completion_tokens for u in self.usages)

    @property
    def total_tokens(self) -> int:
        return sum(u.total_tokens for u in self.usages)

    @property
    def cost_usd(self) -> float:
        # DeepSeek published rates (best-effort; verify at run time)
        return (self.total_prompt / 1_000_000) * 0.07 + (
            self.total_completion / 1_000_000
        ) * 1.10


def chat_once(
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]],
    api_key: str,
) -> tuple[dict[str, Any], dict[str, int]]:
    payload = {
        "model": DEEPSEEK_MODEL,
        "messages": messages,
        "tools": tools,
        "tool_choice": "auto",
    }
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    r = requests.post(DEEPSEEK_URL, json=payload, headers=headers, timeout=120)
    if not r.ok:
        raise RuntimeError(f"DeepSeek {r.status_code}: {r.text[:500]}")
    body = r.json()
    return body["choices"][0]["message"], body.get("usage", {})


def render_text(content: list[dict[str, Any]] | str | None) -> str:
    if isinstance(content, str):
        return content
    if not content:
        return ""
    return "\n".join(b.get("text", "") for b in content if b.get("type") == "text")


def run_one(mode: str, api_key: str) -> RunResult:
    """Spawn bridge in the given mode and run the agent loop."""
    print(f"\n══════════ RUN: mode={mode} model={DEEPSEEK_MODEL} ══════════")
    started = time.time()
    bridge = MCPStdio(
        ["pnpm", "exec", "tsx", "bridge.ts"],
        env={"BRIDGE_MODE": mode},
    )

    try:
        bridge.call(
            "initialize",
            {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {"name": "glyph-comparative", "version": "0.1.0"},
            },
        )
        bridge.notify("notifications/initialized")

        list_result = bridge.call("tools/list")
        mcp_tools = list_result.get("tools", [])
        print(f"[{mode}] bridge exposes {len(mcp_tools)} tools")
        openai_tools = mcp_tools_to_openai_tools(mcp_tools)

        enc = tiktoken.get_encoding("cl100k_base")
        listing_tokens = len(enc.encode(json.dumps(openai_tools)))
        print(f"[{mode}] listing tokens (cl100k_base proxy): {listing_tokens}")

        messages: list[dict[str, Any]] = [
            {
                "role": "system",
                "content": (
                    "You are a coding agent with access to tools. Use them to "
                    "complete the task. After all tool work succeeds, reply "
                    "with the requested confirmation line and stop."
                    + (
                        " Tools are discovered lazily: first call glyph_index "
                        "to see the catalog, then glyph_describe for any tool "
                        "you want to use, then glyph_invoke to run it."
                        if mode == "lazy"
                        else ""
                    )
                ),
            },
            {"role": "user", "content": PROMPT},
        ]

        usages: list[TurnUsage] = []
        final_reply = ""
        cumulative_cost = 0.0
        turn = 0
        while turn < MAX_TURNS:
            turn += 1
            print(f"[{mode}] turn {turn}/{MAX_TURNS}…")
            assistant, usage = chat_once(messages, openai_tools, api_key)
            tool_calls = assistant.get("tool_calls") or []
            tu = TurnUsage(
                turn=turn,
                prompt_tokens=usage.get("prompt_tokens", 0),
                completion_tokens=usage.get("completion_tokens", 0),
                total_tokens=usage.get("total_tokens", 0),
                tool_calls=[tc["function"]["name"] for tc in tool_calls],
            )
            usages.append(tu)
            cumulative_cost = (
                sum(u.prompt_tokens for u in usages) / 1_000_000
            ) * 0.07 + (
                sum(u.completion_tokens for u in usages) / 1_000_000
            ) * 1.10
            if cumulative_cost > MAX_BUDGET_USD:
                print(f"[{mode}] BUDGET EXCEEDED at ${cumulative_cost:.4f} — stopping")
                final_reply = f"(halted: budget cap ${MAX_BUDGET_USD:.2f} exceeded)"
                break

            messages.append(assistant)

            if not tool_calls:
                final_reply = assistant.get("content") or ""
                print(f"[{mode}] FINAL: {final_reply[:200]}")
                break

            for tc in tool_calls:
                name = tc["function"]["name"]
                args_str = tc["function"].get("arguments", "{}")
                try:
                    args = json.loads(args_str) if args_str else {}
                except json.JSONDecodeError:
                    args = {}
                print(f"[{mode}]   → {name}({json.dumps(args)[:80]})")
                try:
                    result = bridge.call(
                        "tools/call",
                        {"name": name, "arguments": args},
                    )
                    text = render_text(result.get("content"))
                except Exception as e:
                    text = f"tool error: {e}"
                messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": tc["id"],
                        "content": text[:8000],
                    }
                )

        elapsed = time.time() - started
        return RunResult(
            mode=mode,
            tools_exposed=len(mcp_tools),
            listing_tokens=listing_tokens,
            usages=usages,
            final_reply=final_reply,
            elapsed_s=elapsed,
        )
    finally:
        bridge.close()


def build_report(eager: RunResult, lazy: RunResult) -> str:
    def pct(a: int, b: int) -> str:
        if a == 0:
            return "n/a"
        return f"{((a - b) / a) * 100:+.1f}%"

    lines = [
        "# Glyph Protocol — eager vs lazy MCP bridge (comparative)",
        "",
        f"- Model: `{DEEPSEEK_MODEL}` (DeepSeek)",
        f"- Prompt: single landing-page task (see scripts/run-comparative.py)",
        f"- Max turns per run: {MAX_TURNS}",
        f"- Budget cap: ${MAX_BUDGET_USD:.2f}",
        "",
        "## Hypothesis",
        "",
        "Lazy mode (3 meta-tools, on-demand card lookup) should spend",
        "dramatically fewer tokens than eager mode (all ~50 tools listed",
        "every turn), because cards the agent never touches never enter",
        "the model's context window.",
        "",
        "## Headline numbers",
        "",
        "| Metric | Eager (A) | Lazy (B) | Δ (B vs A) |",
        "|---|---|---|---|",
        f"| Tools exposed to model | {eager.tools_exposed} | {lazy.tools_exposed} | — |",
        f"| Listing tokens (cl100k_base) | {eager.listing_tokens} | {lazy.listing_tokens} | {pct(eager.listing_tokens, lazy.listing_tokens)} fewer |",
        f"| Turns | {len(eager.usages)} | {len(lazy.usages)} | — |",
        f"| Prompt tokens (total) | {eager.total_prompt} | {lazy.total_prompt} | {pct(eager.total_prompt, lazy.total_prompt)} fewer |",
        f"| Completion tokens (total) | {eager.total_completion} | {lazy.total_completion} | {pct(eager.total_completion, lazy.total_completion)} fewer |",
        f"| **Total tokens** | **{eager.total_tokens}** | **{lazy.total_tokens}** | **{pct(eager.total_tokens, lazy.total_tokens)} fewer** |",
        f"| Estimated cost (USD) | ${eager.cost_usd:.4f} | ${lazy.cost_usd:.4f} | {pct(int(eager.cost_usd * 10000), int(lazy.cost_usd * 10000))} |",
        f"| Wall-clock (s) | {eager.elapsed_s:.1f} | {lazy.elapsed_s:.1f} | — |",
        "",
        "## Per-turn breakdown",
        "",
        "### Eager (A)",
        "",
        "| Turn | Prompt | Completion | Tool calls |",
        "|---|---|---|---|",
    ]
    for u in eager.usages:
        tools_listed = ", ".join(u.tool_calls) if u.tool_calls else "(final)"
        lines.append(
            f"| {u.turn} | {u.prompt_tokens} | {u.completion_tokens} | {tools_listed} |"
        )
    lines.extend(
        [
            "",
            "### Lazy (B)",
            "",
            "| Turn | Prompt | Completion | Tool calls |",
            "|---|---|---|---|",
        ]
    )
    for u in lazy.usages:
        tools_listed = ", ".join(u.tool_calls) if u.tool_calls else "(final)"
        lines.append(
            f"| {u.turn} | {u.prompt_tokens} | {u.completion_tokens} | {tools_listed} |"
        )
    lines.extend(
        [
            "",
            "## Final replies",
            "",
            "### Eager",
            "```",
            eager.final_reply[:2000] or "(no final reply)",
            "```",
            "",
            "### Lazy",
            "```",
            lazy.final_reply[:2000] or "(no final reply)",
            "```",
            "",
            "## Honest caveats",
            "",
            "- `cl100k_base` is a proxy; DeepSeek's tokenizer is not published.",
            "  Treat absolute token counts as ±10%; the ratio between A and B is",
            "  much more robust than the absolute numbers.",
            "- Lazy mode trades ~2 extra round-trips per *new* tool discovered",
            "  for the savings on un-touched tools. With small tool counts it",
            "  can lose; with large tool counts and selective usage it wins big.",
            "- One run per condition; no variance bars. Re-run if you want",
            "  confidence intervals — the script is idempotent.",
            "- Model behavior may differ across providers. This is",
            f"  {DEEPSEEK_MODEL} only.",
            "",
        ]
    )
    return "\n".join(lines)


def main() -> int:
    api_key = os.environ.get("DEEPSEEK_API_KEY")
    if not api_key:
        print("DEEPSEEK_API_KEY env var is required", file=sys.stderr)
        return 2

    eager = run_one("eager", api_key)
    lazy = run_one("lazy", api_key)

    report = build_report(eager, lazy)
    ts = int(time.time())
    out = RESULTS_DIR / f"comparative-{DEEPSEEK_MODEL}-{ts}.md"
    out.write_text(report, encoding="utf-8")
    print(f"\n[done] report written: {out}")
    print(f"[done] eager: {eager.total_tokens} tokens (${eager.cost_usd:.4f})")
    print(f"[done] lazy:  {lazy.total_tokens} tokens (${lazy.cost_usd:.4f})")
    if eager.total_tokens > 0:
        delta = (eager.total_tokens - lazy.total_tokens) / eager.total_tokens * 100
        print(f"[done] lazy is {delta:+.1f}% fewer total tokens than eager")
    return 0


if __name__ == "__main__":
    sys.exit(main())
