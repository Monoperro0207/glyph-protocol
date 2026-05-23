---
'@glyphp/adapter-mcp-server': minor
---

New package: `@glyphp/adapter-mcp-server` — expose a Glyph server's tools to
any MCP client (Claude Desktop, Hermes Agent, Cursor, etc.).

This is the inverse direction of `@glyphp/adapter-mcp` (which adapts MCP
tools *into* Glyph). Together they let Glyph and MCP ecosystems consume
each other.

### What's preserved across the bridge

- Tool name (with automatic normalization for OpenAI's `^[a-zA-Z0-9_-]+$`
  restriction; `fs.read` → `fs_read`, with a reverse alias for calls)
- Intent (as MCP description)
- Risk tier, side-effects, reversibility, confirmation flag — surfaced
  inline in the description so the model can reason about blast radius
- Input schema (verbatim)
- Sanitization annotation — when Glyph removed invisible-Unicode content
  from a payload, a brief note is appended to the MCP response so the
  consuming model knows defense ran

### What's consumed server-side (not exposed to MCP)

- Card signatures (verified by `GlyphClient`)
- Receipt signatures (verified by `GlyphClient`)
- Attestation envelope
- The `requiresConfirmation` ticket flow — calls to confirmation-required
  tools are refused at the bridge with a clear error, since the MCP
  transport has no ticket concept and auto-confirming would defeat the
  gate's purpose

See the package README for the full mapping table.
