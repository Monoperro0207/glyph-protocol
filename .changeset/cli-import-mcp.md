---
'@glyphp/cli': minor
---

Add `glyph import mcp`: a new top-level command that auto-maps MCP servers
from an existing client config (Claude Desktop, Cursor, Codex) or a manual
`--command`/`--url` target into Glyph bridges. Each imported MCP becomes a
self-contained `server.ts` + `package.json` + `.env.example` + `README.md`
under `glyph-imports/<name>/`. A markdown `IMPORT_REPORT.md` summarises
what was imported, what was skipped (with reasons), and which cards the
adapter heuristic tagged as `danger` or `caution` for review.

Failure policy: a single MCP that fails to connect (missing env var,
command not found, timeout) is skipped with a warning, never aborting the
rest of the run. Interactive mode prompts the user to select which client
to read from and which servers within that client to bridge.

`--from openclaw` and `--from hermes-agent` are present in the surface but
deliberately throw `not implemented yet` — see `spec/rfcs/RFC-0004-import-clients.md`
for why we chose loud-failure over a fragile parser.

Pulls in `@modelcontextprotocol/sdk`, `@iarna/toml`, and `@glyphp/adapter-mcp`
as direct dependencies of the CLI.
