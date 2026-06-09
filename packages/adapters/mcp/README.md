# @glyphp/adapter-mcp

Converts the tools of an MCP (Model Context Protocol) server into glyphs you
can register on a `GlyphServer`. Zero dependencies — the MCP client is yours
to bring.

## With an MCP SDK client

```typescript
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { glyphsFromMcpClient } from '@glyphp/adapter-mcp'
import { GlyphServer } from '@glyphp/server'

const client = new Client({ name: 'glyph', version: '0.1.0' })
await client.connect(new StdioClientTransport({ command: 'my-mcp-server' }))

const glyphs = await glyphsFromMcpClient(client)

const server = new GlyphServer({ port: 3100 })
for (const glyph of glyphs) server.register(glyph)
await server.start()
```

`glyphsFromMcpClient` accepts anything matching the SDK `Client` shape, so the
adapter never imports the SDK itself.

## With tools and a call function

```typescript
import { glyphsFromMcpTools } from '@glyphp/adapter-mcp'

const glyphs = glyphsFromMcpTools(tools, (name, args) => callTool(name, args))
```

## What it does

MCP tools carry no cost or risk metadata — exactly the gap Glyph fills. The
adapter maps MCP tool **annotations** onto the glyph cost model:

| MCP annotation | Glyph card |
|---|---|
| `readOnlyHint: true` | `riskTier: safe`, no side effects |
| `destructiveHint: true` | `riskTier: danger`, requires confirmation |
| `idempotentHint: true` | `idempotent: true` |
| (none) | `riskTier: caution` — unknown, so assume side effects |

The tool `description` becomes the glyph `intent`, the `inputSchema` becomes
the card `input`, and the handler proxies the call through `callTool`.

**Annotations are advisory, not authority.** A malicious MCP server can claim
`readOnlyHint: true` on a destructive tool. The adapter therefore also inspects
the tool **name**: if it contains a dangerous word (`delete`, `write`,
`destroy`, `drop`, `exec`, `update`, …) the glyph is forced to `riskTier:
danger` and `requiresConfirmation`, overriding a benign annotation.

## Hardening an untrusted server

All four limits below are **opt-in** and default to the existing behavior:

| Option | Effect |
|---|---|
| `maxTools` | Throws if the server advertises more than N tools, bounding the agent's tool surface instead of importing thousands. |
| `redactDescriptions` | Keeps attacker-controlled descriptions out of `card.intent` (uses the tool name), so a server can't smuggle instructions or secrets into a card a human reviews. |
| `sanitizeErrors` | Surfaces a generic failure message instead of echoing upstream error text that may carry secrets or injected content. |
| `listToolsTimeoutMs` | Bounds the `listTools()` call so a hung or slow server can't stall import. |

```ts
const glyphs = await glyphsFromMcpClient(client, {
  maxTools: 128,
  redactDescriptions: true,
  sanitizeErrors: true,
  listToolsTimeoutMs: 5000,
})
```
