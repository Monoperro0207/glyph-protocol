---
'@glyphp/cli': minor
---

`glyph init` now supports 5 profiles (plus `local-dev`), and prompts
interactively when run on a TTY without `--profile`:

- `production-server` (recommended, default) — stable key, auth, rate
  limit, pin store.
- `agent-ts` — TypeScript consumer with `FilePinStore` and `renderEnvelope`.
- `mcp-bridge` — Glyph server that re-exports an MCP server via
  `@glyphp/adapter-mcp`.
- `openapi-wrapper` — Glyph server that re-exports an OpenAPI 3.x spec via
  `@glyphp/adapter-openapi`.
- `python-client` — Python script using `glyph-protocol` on PyPI.
- `local-dev` — ephemeral key, no auth (prototyping only).

`--profile consumer-agent` continues to work as an alias for `agent-ts`.
