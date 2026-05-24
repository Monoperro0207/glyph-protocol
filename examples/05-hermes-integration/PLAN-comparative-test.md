# Comparative test plan: Hermes Agent — with vs without Glyph

## Hypothesis

Wrapping tools in Glyph metadata costs N tokens of prompt overhead per turn and Y tokens per tool-call result (sanitization annotations). Across a realistic landing-page generation task with 50+ tools available, is N + Y materially significant compared to the baseline?

## Method

For each of 3 landings (different categories, different complexity), run Hermes Agent twice:

| Condition | Tools | Bridge | LLM |
|---|---|---|---|
| **Baseline (A)** | Hermes' ~50 native tools | none | DeepSeek-V4 Flash |
| **With Glyph (B)** | Same Hermes tools + Glyph→MCP bridge serving 8 additional Glyph-wrapped tools (filesystem, http, sql, math, util — already built in `server.ts`) | yes | DeepSeek-V4 Flash |

The Glyph bridge in B exposes the same kinds of tools (fs, http, etc.) Hermes has natively. The model can choose either. The difference: Glyph tools come with signed cards, risk annotations, and sanitization. We measure what that costs in tokens.

## Three landings (extracted from the user's PDF)

Each prompt is adapted: "build a landing page for **Glyph Protocol**" using the visual spec from the PDF. Same visual spec, different content/copy from each landing's source.

### Landing #1 — "Finlytic-style" (SaaS hero, dark, video background, glassmorphic CTA)

Source: PDF entry #005 (`finlytic-hero`, SaaS, hero). Adapted:

> Build a hero section for **Glyph Protocol** (a content-addressed signed tool protocol for AI agents). Full-width black background (#000000), 120% scaled looping background video behind content, blurred pill element above video. Navbar with logo "GLYPH" and links Home / Docs / Spec / Contact. Centered hero with two-line headline using Inter Medium 76px + Instrument Serif italic 76px: "Signed tool contracts. *Auditable agents.*" Subtitle in Manrope 18px: "Content-addressed glyph cards, ed25519 signatures, and consumer-side pinning — for agents that need audit trails." Two CTAs: "Get Started Free" (#7b39fc bg) and "Read the Spec" (#2b2344 bg). Save HTML+CSS to `landing-1/` in the workspace.

### Landing #2 — "Liquid Glass" (full landing, premium editorial, glassmorphism)

Source: PDF entry #012 (`liquid-glass-agency`, Landing Page). Adapted:

> Build a **full single-page landing site for Glyph Protocol** in dark editorial aesthetic with glassmorphism. Sections: hero with cinematic video background, "Why Glyph" with 4 feature cards (Signed Cards, Pinning, Sanitization, Attestation), "How It Works" with 3 steps, stats section ("8 packages on npm", "176/176 tests", "0.3.x latest"), testimonials section (3 quotes from invented adopters), CTA section, footer. Use Tailwind, Instrument Serif italic for headings, Barlow for body. Implement `.liquid-glass` and `.liquid-glass-strong` CSS utilities. Save everything to `landing-2/`.

### Landing #3 — "Nickel-style" (clean fintech-y SaaS hero, warm off-white)

Source: PDF entry #040 (`nickel-hero`, SaaS). Adapted:

> Build a landing-page hero for **Glyph Protocol** with a floating navbar. Use React + Tailwind. Warm off-white background (`hsl(249 18% 95%)`), near-black text, warm orange accent (`hsl(24 90% 55%)`). White floating navbar with rounded-xl shadow, logo as small black-circle-with-white-square + "glyph". Center links: Docs, Spec, GitHub. Right side: "Read the spec" and a hero "Install" button. Hero text block: H1 "Tool contracts your agent can trust", subtitle "Signed cards, content-addressed updates, pinning gates — install with npm and ship today." CTAs "Install now" (warm gradient orange) and "Show me the receipts" (white). Right side: looping muted background video at 55% width. Save to `landing-3/`.

## Tool inventory

Will be captured at run start via `hermes tools` + the bridge's `tools/list` and saved to `results/tool-inventory-<run>.json`. Expected: ~50 from Hermes native + 8 from Glyph bridge in condition B = ~58 total visible to the model.

## Measurements (per run)

Captured by intercepting DeepSeek's `/v1/chat/completions` responses:

| Metric | Source |
|---|---|
| `prompt_tokens` per turn | `usage.prompt_tokens` from response |
| `completion_tokens` per turn | `usage.completion_tokens` |
| `total_tokens` per turn | sum |
| Tool calls per turn (count + names) | parsed from `tool_calls` array |
| Wall-clock seconds per turn | timestamp diff |
| Final output size | bytes of HTML+CSS produced |
| Tool inventory listing tokens | tiktoken `cl100k_base` proxy |
| Glyph metadata overhead (B only) | listing tokens delta vs minimal MCP shape |

## Cost estimate (rough, to set expectations)

At DeepSeek-V4 Flash pricing (~$0.07/M input, $1.10/M output) and realistic agentic generation tasks (~50-100k tokens per landing):

- Per landing per condition: $0.05–$0.15
- 3 landings × 2 conditions: $0.30–$0.90 total
- All-in budget cap: **set `MAX_BUDGET_USD=2.00` to halt if it overshoots**

## Constraint: Hermes Agent setup

Hermes is heavy. Installation pulls Python 3.11, uv, ripgrep, ffmpeg, git, ~75 tool files, MCP SDK, openrouter-client, etc. In Docker the image build is ~10-15 minutes the first time, ~1 min on cached subsequent builds.

Hermes has `run_agent.py` for non-interactive use, which is what we'll script against. The driver:

1. Imports `AIAgent` from Hermes' `run_agent.py`
2. Configures it: `base_url=https://api.deepseek.com/v1`, `model=deepseek-v4-flash`, `api_key=$DEEPSEEK_API_KEY`
3. Enables Hermes' default toolset (file_operations, terminal_tool, browser_tool, code_execution_tool, web_tools, etc.)
4. (Condition B only) Adds the Glyph bridge as an MCP server entry
5. Runs `agent.run_conversation(prompt)` for each landing
6. Captures the full trajectory + token usage

## Open risks I'll surface as we go

1. **Hermes' default tools may not actually number 50.** Many of the 75 files in `tools/` are utilities (path_security, schema_sanitizer). Real model-facing tools may be ~30. I'll report the actual count and adjust the "50 tools" framing in the final document.
2. **Hermes' install in Docker can fail** if optional skills require GPU or platform-specific binaries. Will install the minimal toolset distribution (no GPU-only tools).
3. **DeepSeek-V4 Flash may behave differently on long contexts.** If a single turn approaches 1M context I'll truncate the tool-output history.
4. **The model may not invoke many tools** for some prompts (e.g., it just emits HTML directly). That's data, not failure — we document tool usage as it is.

## Deliverables

- `examples/05-hermes-integration/results/comparative/` — per-run logs and raw token data
- `spec/tests/hermes-comparative-deepseek.md` — final report:
  - Methodology summary
  - 3 landings × 2 conditions = 6 runs documented
  - Token usage comparison table
  - Glyph metadata overhead in absolute and percentage terms
  - Output quality observations (subjective but documented)
  - Tool-usage patterns: did the model prefer Glyph tools? Hermes tools? Mix?
  - Honest limits: what this proves and doesn't prove
- Each landing's generated HTML+CSS saved for inspection
