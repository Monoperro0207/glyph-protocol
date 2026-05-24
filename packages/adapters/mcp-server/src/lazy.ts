/**
 * Lazy bridge mode — Glyph's actual cost-saving philosophy.
 *
 * Where the eager bridge (in `index.ts`) dumps every card's schema into
 * `tools/list` (so a 50-tool server costs ~12k tokens per turn), the lazy
 * bridge exposes **only three meta-tools** to MCP:
 *
 *   1. `glyph_index`   → cheap directory: [{name, oneLineIntent, riskTier}]
 *   2. `glyph_describe` → full card for a single tool (schema, cost, etc.)
 *   3. `glyph_invoke`  → run the underlying glyph
 *
 * The model navigates: list cheap → describe what it needs → invoke. Cards
 * the agent never touches never enter context. For a 50-tool server on a
 * 10-turn task that touches ~6 tools, this is typically an 80-95% reduction
 * in tokens spent on tool descriptions vs eager MCP, at the cost of 2 extra
 * round-trips per "new" tool the agent decides to use.
 *
 * Trade-off (honest): smaller models may stumble. They have to "discover"
 * tools rather than see them all at once. If your model can't handle that,
 * use eager mode. Test, don't assume.
 */
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { GlyphClient } from '@glyphp/client'
import type { GlyphCard, SealedEnvelope } from '@glyphp/types'

export interface LazyBridgeOptions {
  serverName?: string
  serverVersion?: string
}

const META_TOOLS = [
  {
    name: 'glyph_index',
    description:
      'List all available Glyph tools as {name, intent, riskTier}. Cheap — call this first to see what is available, then call glyph_describe for any tool you want to use.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'glyph_describe',
    description:
      'Get the full card for a single Glyph tool: input schema, output shape, side effects, reversibility, risk. Call this before glyph_invoke so you know what arguments to pass.',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
    },
  },
  {
    name: 'glyph_invoke',
    description:
      'Invoke a Glyph tool by name with arguments. The arguments object must match the inputSchema you saw from glyph_describe. Returns the tool output.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        arguments: { type: 'object' },
      },
      required: ['name', 'arguments'],
    },
  },
]

export function mcpServerFromGlyphLazy(
  client: GlyphClient,
  options: LazyBridgeOptions = {}
): Server {
  const server = new Server(
    {
      name: options.serverName ?? 'glyph-mcp-bridge-lazy',
      version: options.serverVersion ?? '0.1.0',
    },
    { capabilities: { tools: {} } }
  )

  // Card cache so describe/invoke don't re-fetch.
  const cards = new Map<string, GlyphCard>()
  let indexLoaded = false

  async function ensureIndex(): Promise<void> {
    if (indexLoaded) return
    const lexicon = await client.getLexicon()
    for (const entry of lexicon) {
      const card = await client.getCard(entry.name, 'rich')
      cards.set(entry.name, card)
    }
    indexLoaded = true
  }

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: META_TOOLS,
  }))

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params
    try {
      if (name === 'glyph_index') {
        await ensureIndex()
        const entries = Array.from(cards.values()).map((c) => ({
          name: c.name,
          intent: c.intent,
          riskTier: c.cost.riskTier,
        }))
        return {
          content: [{ type: 'text', text: JSON.stringify(entries) }],
        }
      }
      if (name === 'glyph_describe') {
        await ensureIndex()
        const target = (args as { name?: string } | undefined)?.name
        if (!target) {
          return errorResult('glyph_describe requires {name}')
        }
        const card = cards.get(target)
        if (!card) return errorResult(`unknown glyph: ${target}`)
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                name: card.name,
                intent: card.intent,
                input: card.input,
                output: card.output,
                cost: card.cost,
              }),
            },
          ],
        }
      }
      if (name === 'glyph_invoke') {
        await ensureIndex()
        const p = (args ?? {}) as {
          name?: string
          arguments?: Record<string, unknown>
        }
        if (!p.name) return errorResult('glyph_invoke requires {name}')
        const card = cards.get(p.name)
        if (!card) return errorResult(`unknown glyph: ${p.name}`)
        if (card.cost.requiresConfirmation) {
          return errorResult(
            `glyph "${p.name}" requires confirmation; not supported via MCP bridge`
          )
        }
        const envelope = (await client.call(
          p.name,
          p.arguments ?? {}
        )) as SealedEnvelope
        return envelopeToMcpResult(envelope)
      }
      return errorResult(`unknown meta-tool: ${name}`)
    } catch (err) {
      return errorResult(
        `lazy bridge error: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  })

  return server
}

function errorResult(msg: string): {
  isError: boolean
  content: Array<{ type: string; text: string }>
} {
  return { isError: true, content: [{ type: 'text', text: msg }] }
}

function envelopeToMcpResult(envelope: SealedEnvelope): {
  content: Array<{ type: string; text: string }>
} {
  const blocks: Array<{ type: string; text: string }> = [
    {
      type: 'text',
      text:
        typeof envelope.payload === 'string'
          ? envelope.payload
          : JSON.stringify(envelope.payload),
    },
  ]
  const inspection = envelope.inspection
  if (inspection && inspection.findings.length > 0) {
    const counts = new Map<string, number>()
    for (const f of inspection.findings) {
      counts.set(f.kind, (counts.get(f.kind) ?? 0) + f.count)
    }
    const breakdown = Array.from(counts.entries())
      .map(([k, n]) => `${n} ${k}`)
      .join(', ')
    const total = Array.from(counts.values()).reduce((a, b) => a + b, 0)
    blocks.push({
      type: 'text',
      text: `[glyph: sanitized ${total} invisible character(s) — ${breakdown}]`,
    })
  }
  return { content: blocks }
}

export async function runStdioBridgeLazy(
  client: GlyphClient,
  options?: LazyBridgeOptions
): Promise<Server> {
  const server = mcpServerFromGlyphLazy(client, options)
  await server.connect(new StdioServerTransport())
  return server
}
