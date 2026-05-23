---
'@glyphp/adapter-mcp-server': minor
---

Add lazy bridge mode: `mcpServerFromGlyphLazy()` / `runStdioBridgeLazy()`.

The eager bridge (default) surfaces every Glyph card as its own MCP tool,
so every `tools/list` carries every schema. That is simple and works with
any MCP client, but the listing scales linearly with catalog size.

Lazy mode exposes only three meta-tools — `glyph_index`,
`glyph_describe`, `glyph_invoke` — and lets the model navigate. Cards the
agent never touches never enter context.

In a measured comparison (`spec/tests/hermes-comparative-deepseek.md`,
same prompt, same 49 tools, `deepseek-v4-pro`):

- Listing tokens: 4,129 → 256 (−93.8%)
- Total tokens across the task: 168,971 → 77,576 (−54.1%)
- Estimated cost: $0.0227 → $0.0137 (−40%)

The trade-off is honest: 2 extra round-trips at the start of a session
for discovery. For very small catalogs (< ~10 tools) or one-shot tasks,
eager mode is still preferable. The two modes are exported side-by-side;
pick the right one for your shape of problem.
