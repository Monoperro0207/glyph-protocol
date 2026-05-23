# @glyphp/adapter-mcp-server

> Expose a [Glyph Protocol](https://github.com/Monoperro0207/glyph-protocol) server's tools to any [Model Context Protocol](https://modelcontextprotocol.io) client (Claude Desktop, Hermes Agent, Cursor, etc.).

This is the **inverse direction** of `@glyphp/adapter-mcp` (which adapts MCP tools *into* Glyph). Together they let the two ecosystems consume each other.

## Install

```bash
pnpm add @glyphp/adapter-mcp-server @glyphp/client
```

## Use

```ts
import { GlyphClient } from '@glyphp/client'
import { runStdioBridge } from '@glyphp/adapter-mcp-server'

const client = new GlyphClient({ baseUrl: 'http://localhost:3199' })
await runStdioBridge(client) // MCP stdio server now serving Glyph tools
```

Point any MCP client at the resulting process — `claude_desktop_config.json`, Hermes Agent's `mcp_servers` block, Cursor's MCP setting — and the Glyph server's tools appear as native MCP tools.

## Honest mapping

MCP and Glyph are not isomorphic. The bridge preserves what MCP can carry and consumes the rest server-side:

| Glyph concept | What the bridge does |
|---|---|
| `card.name` | Becomes the MCP tool name |
| `card.intent` | Becomes the MCP tool description |
| `card.cost.riskTier` / `sideEffects` / `reversible` | Surfaced **in the description** so the model can reason about blast radius before invoking |
| `card.input` schema | Passed through verbatim as MCP `inputSchema` |
| `card.publicKey` / `signature` | Verified by `GlyphClient` server-side — **not exposed to MCP** (MCP has nowhere to put them) |
| `cost.requiresConfirmation: true` | Refused at the bridge with a clear error — the MCP transport has no ticket/confirmation flow, and auto-confirming would defeat the gate |
| `SealedEnvelope.receipt` | Verified server-side, then **dropped** — MCP has no signed-receipt concept |
| `SealedEnvelope.inspection` | When sanitization removed content, a short annotation is appended to the MCP response text so the consuming model knows defense ran |
| `card.attestation` | **Not exposed.** A consumer that needs to verify attestations should speak Glyph natively |

If your use case requires the cryptographic guarantees (signed receipts for audit, attestation verification, pinning gates), use `@glyphp/client` directly. The bridge is for **integration with the MCP ecosystem**, not for security-critical paths.

## License

Apache-2.0
