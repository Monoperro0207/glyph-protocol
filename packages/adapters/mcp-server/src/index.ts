/**
 * @glyphp/adapter-mcp-server — expose a Glyph Protocol server's tools to any
 * MCP client.
 *
 * Two modes:
 *   - **Eager** (this file): every Glyph card surfaced as an MCP tool. Simple,
 *     works with any MCP client, but every `tools/list` carries every schema.
 *   - **Lazy** (`./lazy.ts`): only three meta-tools (`glyph_index`,
 *     `glyph_describe`, `glyph_invoke`). The model navigates on demand.
 *     Tokens spent on tool descriptions drop ~80-95% on multi-tool servers.
 *
 * This is the inverse direction of `@glyphp/adapter-mcp`. Together they let
 * Glyph and MCP ecosystems consume each other.
 *
 * ## Honest mapping notes
 *
 * MCP and Glyph are not isomorphic. The bridge preserves what MCP can carry
 * and consumes the rest server-side:
 *
 * - **Preserved**: tool name, intent (as description), input schema, output
 *   payload, risk-tier as a description annotation.
 * - **Surfaced as MCP isError**: confirmation gate refusals (when a Glyph
 *   tool declares `requiresConfirmation`, the bridge cannot satisfy the
 *   ticket flow for an MCP client that has no ticket concept — the call is
 *   refused with a clear error).
 * - **Consumed server-side**: card signatures (verified by GlyphClient),
 *   receipt signatures (verified by GlyphClient), the SealedEnvelope's
 *   `inspection` report — when it removed anything, a brief note is appended
 *   to the MCP content so the calling model sees that sanitization happened.
 * - **Lost**: the cryptographic receipt itself, the publicKey, the
 *   attestation envelope. MCP has nowhere to put them. This is the
 *   structural reason a security-conscious consumer should speak Glyph
 *   natively rather than through this bridge.
 *
 * See `spec/tests/hermes-deepseek.md` for a worked example.
 */

import type { GlyphClient } from '@glyphp/client'
import type { GlyphCard, SealedEnvelope } from '@glyphp/types'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'

export interface BridgeOptions {
  /** Reported as the MCP server name on handshake. */
  serverName?: string
  /** Reported as the MCP server version on handshake. */
  serverVersion?: string
  /**
   * When false, the bridge fetches the lexicon on every `tools/list` call.
   * When true (default), it caches per session for speed. Cache lives for
   * the lifetime of the bridge process; restart to pick up new tools.
   */
  cacheLexicon?: boolean
}

/**
 * Builds an MCP Server that exposes a Glyph server's tools. Wire it up with
 * any transport — stdio is most common.
 *
 * @example
 *   const client = new GlyphClient({ baseUrl: 'http://localhost:3199' })
 *   const server = mcpServerFromGlyph(client)
 *   await server.connect(new StdioServerTransport())
 */
export function mcpServerFromGlyph(client: GlyphClient, options: BridgeOptions = {}): Server {
  const server = new Server(
    {
      name: options.serverName ?? 'glyph-mcp-bridge',
      version: options.serverVersion ?? '0.1.0',
    },
    { capabilities: { tools: {} } },
  )

  /**
   * MCP tool names match OpenAI's restriction: `^[a-zA-Z0-9_-]+$`. Glyph
   * allows richer names (dots, slashes) — `fs.read`, `db/query`, etc. We
   * translate by replacing every disallowed character with `_` and keep a
   * reverse map so `tools/call` can find the original card. Collisions are
   * caught at registration time (two glyph names that normalize to the same
   * MCP name throw).
   */
  let cardCache: Map<string, GlyphCard> | undefined
  /** mcp-safe-name → original card.name */
  let nameAlias: Map<string, string> | undefined

  const sanitizeMcpName = (name: string): string => name.replace(/[^a-zA-Z0-9_-]/g, '_')

  const loadCards = async (): Promise<{
    cards: Map<string, GlyphCard>
    alias: Map<string, string>
  }> => {
    if (cardCache && nameAlias && options.cacheLexicon !== false) {
      return { cards: cardCache, alias: nameAlias }
    }
    const lexicon = await client.getLexicon()
    const cards = new Map<string, GlyphCard>()
    const alias = new Map<string, string>()
    for (const entry of lexicon) {
      const card = await client.getCard(entry.name, 'rich')
      cards.set(entry.name, card)
      const safe = sanitizeMcpName(entry.name)
      if (alias.has(safe)) {
        throw new Error(
          `MCP name collision: glyph "${entry.name}" and "${alias.get(safe)}" both normalize to "${safe}". Rename one.`,
        )
      }
      alias.set(safe, entry.name)
    }
    cardCache = cards
    nameAlias = alias
    return { cards, alias }
  }

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const { cards } = await loadCards()
    return {
      tools: Array.from(cards.values()).map((card) => ({
        name: sanitizeMcpName(card.name),
        description: describeForMcp(card),
        inputSchema: (card.input as Record<string, unknown>) ?? {
          type: 'object',
        },
      })),
    }
  })

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params
    const { cards, alias } = await loadCards()
    // Accept either the MCP-safe name (what the model saw) or the original
    // glyph name. Most clients echo the listed name verbatim.
    const originalName = alias.get(name) ?? name
    const card = cards.get(originalName)
    if (!card) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Unknown Glyph tool: ${name}` }],
      }
    }
    // Glyph's confirmation gate has no MCP equivalent. Refusing here surfaces
    // the requirement to the model rather than silently approving — which
    // would defeat the gate's purpose.
    if (card.cost.requiresConfirmation) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Glyph tool "${name}" requires confirmation. The MCP bridge cannot satisfy this flow — call this tool via a native Glyph client that supports the prepare/confirm handshake.`,
          },
        ],
      }
    }
    try {
      const envelope = (await client.call(
        originalName,
        (args ?? {}) as Record<string, unknown>,
      )) as SealedEnvelope
      return envelopeToMcpResult(envelope)
    } catch (err) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Glyph call failed: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
      }
    }
  })

  return server
}

/**
 * Builds the MCP `description` string the model sees. We surface the risk
 * tier and confirmation flag in plain language so the model can reason about
 * blast radius before invoking — matching the spirit of MCP's annotations
 * but with the explicit Glyph vocabulary preserved.
 */
function describeForMcp(card: GlyphCard): string {
  const tags: string[] = []
  if (card.cost.riskTier !== 'safe') {
    tags.push(`risk: ${card.cost.riskTier}`)
  }
  if (card.cost.sideEffects) tags.push('has side effects')
  if (!card.cost.reversible) tags.push('not reversible')
  if (card.cost.requiresConfirmation) tags.push('requires confirmation')
  const suffix = tags.length > 0 ? ` (${tags.join(', ')})` : ''
  return `${card.intent}${suffix}`
}

/**
 * Maps a SealedEnvelope to an MCP CallToolResult. We:
 *  - Encode the payload as a single text content block (JSON-stringified).
 *  - If sanitization removed anything, append a brief annotation so the
 *    model sees that Glyph defended against invisible content — this is the
 *    only place the bridge surfaces the security work it did.
 */
function envelopeToMcpResult(envelope: SealedEnvelope): {
  content: Array<{ type: string; text: string }>
} {
  const blocks: Array<{ type: string; text: string }> = [
    {
      type: 'text',
      text:
        typeof envelope.payload === 'string'
          ? envelope.payload
          : JSON.stringify(envelope.payload, null, 2),
    },
  ]
  const inspection = envelope.inspection
  if (inspection && inspection.findings.length > 0) {
    const counts = new Map<string, number>()
    for (const f of inspection.findings) {
      counts.set(f.kind, (counts.get(f.kind) ?? 0) + f.count)
    }
    const breakdown = Array.from(counts.entries())
      .map(([kind, count]) => `${count} ${kind}`)
      .join(', ')
    const total = Array.from(counts.values()).reduce((a, b) => a + b, 0)
    blocks.push({
      type: 'text',
      text: `[glyph: sanitized ${total} invisible character(s) from this output — ${breakdown}]`,
    })
  }
  return { content: blocks }
}

/**
 * Convenience: builds the bridge and connects it over stdio. Useful for a
 * one-line bin script. Resolves once the transport is wired.
 */
export async function runStdioBridge(
  client: GlyphClient,
  options?: BridgeOptions,
): Promise<Server> {
  const server = mcpServerFromGlyph(client, options)
  await server.connect(new StdioServerTransport())
  return server
}

export {
  type LazyBridgeOptions,
  mcpServerFromGlyphLazy,
  runStdioBridgeLazy,
} from './lazy.js'
