---
"@glyphp/server": minor
"@glyphp/adapter-openapi": minor
"@glyphp/adapter-mcp": minor
"@glyphp/cli": patch
---

P1 hardening from the external audit.

`@glyphp/server` — a glyph handler now receives a `GlyphHandlerContext` with an
`AbortSignal` that fires when the call exceeds its timeout, so a cooperating
handler can stop doing real work instead of running on in the background after
the `504`.

`@glyphp/adapter-openapi` / `@glyphp/adapter-mcp` — the JSON Schema → Zod
conversion is now recursive: enums, typed arrays, nested objects and common
string formats are enforced, instead of only a value's top-level type.

`@glyphp/cli` — `glyph init` scaffolds `@glyphp/server` at `latest` rather than
a pinned version that goes stale.
