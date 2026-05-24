# Comparative test — eager vs lazy MCP bridge

> Annexed to the protocol as evidence. Same prompt, same model, same 49
> underlying Glyph tools, single variable: bridge mode.

## Why this exists

The earlier integration test
(`spec/tests/hermes-deepseek.md`) measured Glyph through an *eager* MCP
bridge — every card surfaced as an MCP tool, every `tools/list` carrying
every schema. That test showed Glyph metadata costing ~70% **more** tokens
than minimal MCP for the listing alone. A fair result for that bridge, but
it does not reflect Glyph's intended consumption pattern.

Glyph's design assumes the model **navigates** the lexicon — index, then
describe, then invoke — so cards the agent never touches never enter
context. This second test exercises that pattern with a 49-tool surface and
measures the delta.

## Setup

| Knob | Value |
|---|---|
| Model | `deepseek-v4-pro` (DeepSeek, OpenAI-compatible API) |
| Bridge package | `@glyphp/adapter-mcp-server` (in this repo) |
| Glyph server | `examples/05-hermes-integration/server.ts` — 49 tools across fs, http, sql, math, text, encoding, color, css, html, time, util, hash families |
| Underlying client | `@glyphp/client` over local HTTP, in-process |
| Task | Build a single self-contained landing page for "Glyph Protocol" (HTML + embedded CSS) into `/workspace/landing/`. Forces tool variety: slugs, color helpers, hashing, html escape, fs.write, uuid, iso time |
| Token counter | `tiktoken` `cl100k_base` (proxy — DeepSeek's tokenizer is not published) |
| Runs per condition | 1 (no variance bars; see caveats) |
| Max turns | 25 |
| Budget cap | $2.00 |

Conditions:

- **A — Eager**: `mcpServerFromGlyph()`. All 49 cards are surfaced as MCP
  tools. The model sees every schema on every `tools/list`.
- **B — Lazy**: `mcpServerFromGlyphLazy()`. Three meta-tools surfaced:
  `glyph_index`, `glyph_describe`, `glyph_invoke`. The model navigates.

Driver: `examples/05-hermes-integration/scripts/run-comparative.py`.
Re-runnable; results land in `examples/05-hermes-integration/results/`.

## Results

### Headline

| Metric | Eager (A) | Lazy (B) | Δ |
|---|---:|---:|---:|
| Tools visible in `tools/list` | 49 | 3 | — |
| **Listing tokens** (cl100k\_base) | **4,129** | **256** | **−93.8%** |
| Turns to completion | 14 | 11 | −3 |
| Prompt tokens (sum across turns) | 158,376 | 69,578 | −56.1% |
| Completion tokens (sum across turns) | 10,595 | 7,998 | −24.5% |
| **Total tokens** | **168,971** | **77,576** | **−54.1%** |
| Estimated cost (USD, DeepSeek rates) | $0.0227 | $0.0137 | −40% |
| Wall-clock seconds | 171.6 | 140.1 | −18% |
| Task completion | ✅ | ✅ | both produced a valid 175-line HTML file |

### Per-turn breakdown — eager

| Turn | Prompt | Completion | Tool calls |
|---:|---:|---:|---|
| 1 | 4,337 | 286 | time\_iso, util\_uuid, color\_lighten |
| 2 | 4,712 | 594 | text\_slugify × 3 |
| 3 | 5,364 | 1,549 | fs\_write |
| 4 | 6,969 | 63 | fs\_list |
| 5 | 7,083 | 57 | fs\_list |
| 6 | 7,219 | 1,398 | fs\_write |
| 7 | 8,648 | 174 | fs\_read |
| 8 | 10,368 | 1,946 | text\_split |
| 9 | 13,847 | 455 | text\_split |
| 10 | 14,759 | 450 | math\_hash |
| 11 | 15,272 | 1,571 | text\_replace |
| 12 | 18,369 | 1,389 | fs\_write |
| 13 | 19,789 | 307 | fs\_read |
| 14 | 21,640 | 356 | (final reply) |

Every turn carries the full 4,129-token tool listing.

### Per-turn breakdown — lazy

| Turn | Prompt | Completion | Tool calls |
|---:|---:|---:|---|
| 1 | 830 | 44 | glyph\_index |
| 2 | 2,197 | 400 | glyph\_describe × 7 (discovered tools needed) |
| 3 | 3,660 | 247 | direct tool calls × 6 (model called real names) |
| 4 | 4,011 | 458 | glyph\_invoke × 6 (corrected to bridge protocol) |
| 5 | 4,590 | 1,401 | glyph\_describe |
| 6 | 6,156 | 799 | glyph\_invoke |
| 7 | 7,013 | 1,838 | glyph\_invoke |
| 8 | 8,907 | 86 | glyph\_invoke |
| 9 | 9,042 | 1,651 | glyph\_invoke |
| 10 | 10,717 | 163 | glyph\_invoke |
| 11 | 12,455 | 911 | (final reply) |

Turn 3 is a real artifact: the model briefly tried to call real tool
names directly (`time.iso`, etc.) instead of going through `glyph_invoke`.
It self-corrected by turn 4 once those calls returned "unknown meta-tool".
This is data, not a bug — it is the kind of friction the lazy pattern
imposes on models that have not been fine-tuned for it.

## Where the savings come from

1. **Listing**: 93.8% reduction (4,129 → 256 tokens). This is the
   intended mechanism. With 49 tools, the lazy listing is essentially a
   constant 256 tokens; with eager it scales with the catalog.
2. **History compounding**: in eager mode every prior turn's prompt also
   carried the full listing. Lazy mode's history is lighter, so each new
   turn's prompt is also lighter. This is the secondary multiplier — the
   reason total savings (54%) is much greater than per-call listing
   savings would suggest at first glance.
3. **Fewer turns** in this run (11 vs 14). Not a guarantee; with a model
   that struggles with the navigation pattern, lazy can lose turns to
   discovery overhead. Here it broke even or better.

## Where the savings do **not** reach 90%

The model's hypothesis was ~90% net savings. We measured 54%. The gap:

- Tool **result payloads** (HTML strings, file contents) are unaffected by
  bridge mode — they account for a large slice of prompt tokens once the
  agent starts producing real artifacts.
- Lazy mode pays 1 turn for `glyph_index` + 1 turn for the first batch of
  `glyph_describe` calls before any real work happens. On very short
  tasks, this overhead can outweigh the listing savings.
- The 90% figure holds for the **listing line item in isolation**. The
  total includes assistant content, tool results, and conversation
  history that the bridge mode does not touch.

This is the kind of honest decomposition the protocol report should carry
— "where exactly does the win come from, and what is it not."

## Curve (extrapolation, not measured)

Because eager listing scales linearly with the number of tools and lazy
listing is roughly constant (3 meta-tools), the savings grow with catalog
size:

| Tools | Eager listing tokens (est.) | Lazy listing tokens | Δ |
|---:|---:|---:|---:|
| 10 | ~850 | ~256 | −70% |
| 49 | 4,129 *(measured)* | 256 *(measured)* | −93.8% |
| 100 | ~8,400 | ~256 | −97% |
| 200 | ~16,800 | ~256 | −98.5% |

Not a benchmark — a back-of-envelope. The actual per-tool overhead
depends on schema complexity. The point: lazy mode's main value is at
**scale**.

## Caveats

- **One run per condition.** Variance bars are not included; re-run the
  driver to get them. The script is idempotent.
- **`cl100k_base` is a proxy.** DeepSeek's tokenizer is not publicly
  published; treat absolute token counts as ±10%. The **ratio** between
  conditions is robust.
- **Single model.** `deepseek-v4-pro`. A smaller / weaker model may
  stumble on the navigation pattern and erase the savings; a larger model
  may handle it more smoothly than this one did.
- **Single task.** The task was deliberately tool-varied to exercise the
  catalog, but real workloads vary. The 54% number is a data point, not a
  guarantee.
- **The lazy bridge consumes signatures and attestation server-side**
  exactly like the eager bridge. MCP carries no place for them. A native
  Glyph consumer would preserve all of it.

## Reproducibility

```bash
cd examples/05-hermes-integration
pnpm install                          # workspace install
pip3 install --user requests tiktoken  # one-off
PORT=3199 pnpm exec tsx server.ts &    # leave running
export DEEPSEEK_API_KEY=sk-...
export DEEPSEEK_MODEL=deepseek-v4-pro
python3 scripts/run-comparative.py
```

Raw outputs land in `examples/05-hermes-integration/results/comparative-*.md`.

## Verdict

The lazy bridge mode delivers the cost-reduction Glyph claims, at the size
expected for a real-world tool catalog. The savings are **real, sizable,
and asymmetric** — they grow with catalog size while costing the agent
two extra round-trips at the start. For agentic workloads with large tool
inventories, this is the pattern to use.

For very small tool counts (< ~10) or one-shot tasks, the eager bridge is
fine. The two modes are not competitors; they are tools for different
shapes of problem, and both are exported from
`@glyphp/adapter-mcp-server`.
