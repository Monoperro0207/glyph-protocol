# RFC-0004 — Import clients for `glyph import mcp`

Status: accepted (V1 partial).
Author: Patrick Espino.
Date: 2026-05-24.

## Summary

`glyph import mcp` auto-maps MCP servers from a user's existing
client configs into Glyph bridges. To avoid coupling the protocol to
any one client, the CLI consumes "client adapters" — small modules
that know where a particular host (Claude Desktop, Cursor, Codex, …)
stores its MCP server list and how to parse it. This RFC freezes the
adapter interface and tracks which adapters are shipping when.

## The adapter interface

```ts
interface ClientAdapter {
  id: 'claude-desktop' | 'cursor' | 'codex' | 'openclaw' | 'hermes-agent'
  displayName: string
  configPathHint: string          // shown to the user
  detect(): Promise<boolean>      // true if a config file is readable
  load(): Promise<McpServerConfig[]>
}
```

An adapter never throws on a missing file (returns `false` from
`detect()` and `[]` from `load()` where applicable). It *does* throw
on a present-but-unparseable file so a corrupted config is loud, not
silent.

## V1 — shipping now

| Adapter | Config path | Format | Status |
|---|---|---|---|
| `claude-desktop` | `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS), platform equivalents elsewhere | JSON: `{ mcpServers: { <name>: { command, args?, env? } } }` | ✅ |
| `cursor` | `~/.cursor/mcp.json` + `<cwd>/.cursor/mcp.json` | Same JSON schema as Claude Desktop. Project-scoped shadows global on name collision. | ✅ |
| `codex` | `~/.codex/config.toml` + `<cwd>/.codex/config.toml` | TOML, `[mcp_servers.<name>]` tables (`command`, `args`, `env`, `bearer_token`, optional `url`). Documented at https://developers.openai.com/codex/mcp. | ✅ |

Plus the **manual target** mode (`--command "..."` for stdio, `--url
"..."` for HTTP) which bypasses adapters entirely.

## V2 — pending verification

These adapters exist in the codebase but throw `not implemented yet`
from `load()`. We chose loud failure over a fragile parser.

| Adapter | Why it isn't shipping yet |
|---|---|
| `openclaw` | The README references an "MCP Registry" but does not publish a stable file path or JSON schema. The `/config` directory and `openclaw.json` need to be read in-source before we can commit to a parser. If the format turns out to be DB-driven (no on-disk file), this adapter cannot ship and the entry should be removed. |
| `hermes-agent` | Uses `cli-config.yaml` and env vars. The MCP section schema lives in an external docs site (`hermes-agent.nousresearch.com/docs/user-guide/features/mcp`) and is not pinned in the public README. Needs the YAML keys + types locked before V1 can claim support. |

Path to V2: clone the upstream repo, identify the smallest stable
field set, write `clients/<id>.ts` mirroring the Claude Desktop /
Cursor / Codex parsers, add fixture-based unit tests, remove the
"not implemented yet" stub.

## Failure policy

Per-MCP failures (missing env var, unreachable command, listTools
timeout) **never abort the run**. The failing entry is added to the
`Skipped` section of `IMPORT_REPORT.md` with the exact reason. This
matches the design assumption that real users have ten MCPs with one
broken at a time — the import should keep moving.

## What is intentionally not auto-discovered

Tools that do not live in one of the above client configs cannot be
discovered by `glyph import mcp`. Specifically:

- Tools defined inline in arbitrary TypeScript / Python source files
  using LangChain, OpenAI Agents SDK, Vercel AI SDK, etc.
- MCP servers running on the machine but not registered in any client
  config (they're invisible to us — there is no system-wide MCP
  registry).
- OpenAPI specs (covered separately by `@glyphp/adapter-openapi`; a
  future `glyph import openapi` command will mirror this RFC).

This boundary is honest by design. If a user wants those tools in
Glyph, they either add them to a client config first (then re-run
`import mcp`) or scaffold a project with `glyph init` and write the
`defineGlyph` calls themselves.
