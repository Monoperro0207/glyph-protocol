#!/usr/bin/env python3
"""
Minimal MCP-driven agent loop, using DeepSeek-V4 Flash as the planner and the
Glyph→MCP bridge as the tool transport.

Honest scope: this is NOT Hermes Agent. It's a faithful, minimal reproduction
of what *any* MCP-using agent does — spawn the bridge as a stdio process,
initialize, list tools, run an OpenAI-style chat-completions loop where the
model returns tool_calls and the script dispatches them over MCP.

Why minimal vs. driving Hermes directly: Hermes' non-interactive surface
requires its own config wizard + skill setup which is out of scope for a
single-shot integration test. The harness here uses the same MCP transport
Hermes would use, so it proves the bridge is consumable by any MCP client.
The same `mcp.json` shape is documented in hermes-config/ for users who want
to wire this into a full Hermes deployment.

Reports per-turn token usage and writes a markdown summary to results/.
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
DEEPSEEK_MODEL = os.environ.get("DEEPSEEK_MODEL", "deepseek-v4-flash")
RESULTS_DIR = Path(__file__).resolve().parent.parent / "results"
RESULTS_DIR.mkdir(exist_ok=True)

PROMPT = """\
I need to audit the folder /workspace/test-fixtures/ for me. Please do the
following:

  1. List the files in that folder.
  2. Read each file's content.
  3. Compute a SHA-256 hash of each file's content.
  4. Fetch the URL https://example.org and tell me whether the page mentions
     the word 'IANA'.
  5. Tell me the total size in bytes of all files combined.
  6. Tell me which file was the longest (most bytes).

Use the tools available."""


# ── MCP stdio client ──────────────────────────────────────────────────────
class MCPStdio:
    """Tiny JSON-RPC client over stdio for the bridge subprocess."""

    def __init__(self, cmd: list[str]) -> None:
        self.proc = subprocess.Popen(
            cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
        )
        self._id = 0

    def _next_id(self) -> int:
        self._id += 1
        return self._id

    def call(self, method: str, params: dict[str, Any] | None = None) -> Any:
        req_id = self._next_id()
        req = {"jsonrpc": "2.0", "id": req_id, "method": method}
        if params is not None:
            req["params"] = params
        assert self.proc.stdin is not None
        self.proc.stdin.write(json.dumps(req) + "\n")
        self.proc.stdin.flush()
        # Read until we get a matching id (skip stderr noise lines, server-pushed
        # notifications, etc.). The MCP SDK sends notifications with no `id`.
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
    """MCP `tools/list` → OpenAI `tools` array shape."""
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


# ── DeepSeek chat loop ────────────────────────────────────────────────────
@dataclass
class TurnUsage:
    turn: int
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int
    tool_calls: list[str] = field(default_factory=list)


def chat_once(
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]],
    api_key: str,
) -> tuple[dict[str, Any], dict[str, int]]:
    """One round-trip to /v1/chat/completions. Returns (assistant_message, usage)."""
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
    r = requests.post(DEEPSEEK_URL, json=payload, headers=headers, timeout=60)
    if not r.ok:
        raise RuntimeError(
            f"DeepSeek {r.status_code}: {r.text}\n"
            f"payload tools sample: {json.dumps(payload['tools'][:1])[:500]}"
        )
    body = r.json()
    return body["choices"][0]["message"], body.get("usage", {})


def render_text(content: list[dict[str, Any]] | str | None) -> str:
    """MCP returns content as a list of {type, text}; we flatten to text."""
    if isinstance(content, str):
        return content
    if not content:
        return ""
    return "\n".join(b.get("text", "") for b in content if b.get("type") == "text")


def main() -> int:
    api_key = os.environ.get("DEEPSEEK_API_KEY")
    if not api_key:
        print("DEEPSEEK_API_KEY env var is required", file=sys.stderr)
        return 2

    # Spawn the bridge process. It's a workspace-linked script — invoked via
    # tsx so the source isn't pre-built (lets the test work straight from a
    # checkout without a build step).
    print(f"[agent] starting Glyph→MCP bridge via tsx…")
    bridge = MCPStdio(["pnpm", "exec", "tsx", "bridge.ts"])

    try:
        # MCP handshake: initialize + initialized notification
        bridge.call(
            "initialize",
            {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {"name": "glyph-agent-loop", "version": "0.1.0"},
            },
        )
        bridge.notify("notifications/initialized")

        # Tool discovery
        list_result = bridge.call("tools/list")
        mcp_tools = list_result.get("tools", [])
        print(f"[agent] bridge exposes {len(mcp_tools)} tools")
        openai_tools = mcp_tools_to_openai_tools(mcp_tools)

        # Tokenization comparison: Glyph card lexicon (with metadata) vs
        # equivalent MCP-stripped tool descriptions. Uses cl100k_base as a
        # standard proxy — DeepSeek doesn't publish its tokenizer publicly.
        enc = tiktoken.get_encoding("cl100k_base")
        glyph_tokens = len(enc.encode(json.dumps(mcp_tools)))
        minimal = [
            {"name": t["name"], "description": t.get("description", "")}
            for t in mcp_tools
        ]
        minimal_tokens = len(enc.encode(json.dumps(minimal)))
        listing_compare = {
            "glyph_via_bridge_tokens": glyph_tokens,
            "name_and_description_only_tokens": minimal_tokens,
            "metadata_overhead": glyph_tokens - minimal_tokens,
        }
        print(f"[agent] tool listing tokens: {listing_compare}")

        # Agent loop
        messages: list[dict[str, Any]] = [
            {
                "role": "system",
                "content": "You are a helpful agent with access to tools. Use them to complete the task. After all tool calls succeed, provide a short final answer.",
            },
            {"role": "user", "content": PROMPT},
        ]
        usages: list[TurnUsage] = []
        turn = 0
        max_turns = 15
        while turn < max_turns:
            turn += 1
            print(f"[agent] turn {turn}/{max_turns}…")
            assistant, usage = chat_once(messages, openai_tools, api_key)
            tool_calls = assistant.get("tool_calls") or []
            usages.append(
                TurnUsage(
                    turn=turn,
                    prompt_tokens=usage.get("prompt_tokens", 0),
                    completion_tokens=usage.get("completion_tokens", 0),
                    total_tokens=usage.get("total_tokens", 0),
                    tool_calls=[tc["function"]["name"] for tc in tool_calls],
                )
            )

            # Append assistant message verbatim (OpenAI requires this for
            # the next round to reference tool_call_ids).
            messages.append(assistant)

            if not tool_calls:
                final = assistant.get("content") or ""
                print(f"[agent] FINAL: {final}")
                break

            for tc in tool_calls:
                name = tc["function"]["name"]
                args_str = tc["function"].get("arguments", "{}")
                try:
                    args = json.loads(args_str) if args_str else {}
                except json.JSONDecodeError:
                    args = {}
                print(f"[agent]   → {name}({json.dumps(args)[:80]})")
                result = bridge.call(
                    "tools/call",
                    {"name": name, "arguments": args},
                )
                text = render_text(result.get("content"))
                messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": tc["id"],
                        "content": text[:8000],  # cap to keep context lean
                    }
                )

        # Write the markdown report
        report = build_report(usages, listing_compare, mcp_tools, messages)
        report_path = (
            RESULTS_DIR / f"hermes-deepseek-{int(time.time())}.md"
        )
        report_path.write_text(report, encoding="utf-8")
        print(f"\n[agent] report written: {report_path}")

        return 0
    finally:
        bridge.close()


def build_report(
    usages: list[TurnUsage],
    listing: dict[str, int],
    tools: list[dict[str, Any]],
    transcript: list[dict[str, Any]],
) -> str:
    total_prompt = sum(u.prompt_tokens for u in usages)
    total_completion = sum(u.completion_tokens for u in usages)
    total_tokens = sum(u.total_tokens for u in usages)
    # DeepSeek-V4 Flash published pricing as of 2026-05 (verify in their
    # pricing page when running) — used only for the report ballpark.
    cost_usd = (total_prompt / 1_000_000) * 0.07 + (
        total_completion / 1_000_000
    ) * 1.10
    tool_call_count: dict[str, int] = {}
    for u in usages:
        for tc in u.tool_calls:
            tool_call_count[tc] = tool_call_count.get(tc, 0) + 1
    lines = [
        f"# Glyph Protocol × DeepSeek-V4 Flash × MCP bridge — integration run",
        "",
        f"- **Model**: `{DEEPSEEK_MODEL}` (DeepSeek)",
        f"- **Transport**: Glyph→MCP bridge (stdio), `@glyphp/adapter-mcp-server`",
        f"- **Tools exposed**: {len(tools)}",
        f"- **Turns**: {len(usages)}",
        "",
        "## Tool listing tokenization",
        "",
        f"| Variant | Tokens (cl100k_base) |",
        f"|---|---|",
        f"| Glyph tools via bridge (with risk annotations in description) | {listing['glyph_via_bridge_tokens']} |",
        f"| Name + description only (minimal) | {listing['name_and_description_only_tokens']} |",
        f"| Metadata overhead | {listing['metadata_overhead']} |",
        "",
        "Note: the bridge does *not* surface signatures or attestation to MCP, so this overhead is purely the risk/cost annotations and the JSON-schema input definitions — exactly what a model needs to choose a tool wisely.",
        "",
        "## Per-turn token usage",
        "",
        "| Turn | Prompt | Completion | Total | Tool calls |",
        "|---|---|---|---|---|",
    ]
    cumulative = 0
    for u in usages:
        cumulative += u.total_tokens
        tools_listed = ", ".join(u.tool_calls) if u.tool_calls else "(final reply)"
        lines.append(
            f"| {u.turn} | {u.prompt_tokens} | {u.completion_tokens} | {u.total_tokens} | {tools_listed} |"
        )
    lines.extend(
        [
            "",
            "## Aggregate",
            "",
            f"- Prompt tokens: **{total_prompt}**",
            f"- Completion tokens: **{total_completion}**",
            f"- Total tokens: **{total_tokens}**",
            f"- Estimated cost: **${cost_usd:.4f}** (at $0.07/1M input + $1.10/1M output)",
            "",
            "## Tool invocation breakdown",
            "",
            "| Tool | Calls |",
            "|---|---|",
        ]
    )
    for name in sorted(tool_call_count, key=lambda n: -tool_call_count[n]):
        lines.append(f"| `{name}` | {tool_call_count[name]} |")
    lines.append("")
    # Tail of the transcript for audit (final assistant message)
    final_msg = next(
        (m for m in reversed(transcript) if m.get("role") == "assistant" and not m.get("tool_calls")),
        None,
    )
    if final_msg:
        lines.extend(
            [
                "## Final agent reply",
                "",
                "```",
                str(final_msg.get("content", "")),
                "```",
                "",
            ]
        )
    return "\n".join(lines)


if __name__ == "__main__":
    sys.exit(main())
