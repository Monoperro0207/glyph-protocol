# 03-mcp-filesystem

A **real** protocol-to-protocol bridge: connect to an actual MCP server,
convert its real tools into glyphs, and serve them over the Glyph protocol.

No mocks — `server.ts` spawns the official
[`@modelcontextprotocol/server-filesystem`](https://www.npmjs.com/package/@modelcontextprotocol/server-filesystem)
over stdio and adapts whatever tools it advertises.

## Commands

```bash
# From repo root
pnpm install

# Terminal 1 — adapt the MCP server and serve it as glyphs
cd examples/03-mcp-filesystem
pnpm run server

# Terminal 2 — discover and call a glyph
cd examples/03-mcp-filesystem
pnpm run client
```

The first run downloads the MCP filesystem server via `npx` — needs network.

## What happens

1. `server.ts` connects to a live MCP filesystem server over stdio
2. `glyphsFromMcpClient` lists its real tools and turns each into a glyph —
   the MCP `description` becomes the `intent`, MCP annotations become the
   cost/risk tier
3. `GlyphServer` serves those glyphs over HTTP
4. `client.ts` does a handshake, uses `@glyphp/resolver` to map the
   natural-language intent *"list the files in a directory"* to a glyph, and
   calls it on this example's own folder
5. The result is a **real directory listing** produced by the MCP server,
   delivered inside a Glyph `SealedEnvelope`
