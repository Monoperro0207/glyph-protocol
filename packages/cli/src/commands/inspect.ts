import { GlyphClient } from '@glyphp/client'
import { verifyGlyph } from '@glyphp/core'
import type { GlyphCard, HandshakeResponse } from '@glyphp/types'

/** Connects to a Glyph server and renders its lexicon, or one glyph card. */
export async function runInspect(url: string, glyphName?: string): Promise<string> {
  const client = new GlyphClient({ baseUrl: url })
  if (glyphName) {
    const card = await client.getCard(glyphName, 'rich')
    return formatCard(card)
  }
  const handshake = await client.connect()
  return formatOverview(url, handshake)
}

/** Renders a server's handshake response — protocol info and the lexicon. */
export function formatOverview(url: string, handshake: HandshakeResponse): string {
  const lines = [
    `Glyph server  ${url}`,
    `protocol ${handshake.protocolVersion}  ·  server ${handshake.serverVersion}  ·  ${handshake.lexicon.length} glyph(s)`,
  ]
  if (handshake.lexicon.length === 0) {
    lines.push('', '  (no glyphs registered)')
    return lines.join('\n')
  }
  lines.push('')
  for (const g of [...handshake.lexicon].sort((a, b) => a.name.localeCompare(b.name))) {
    lines.push(`  [${g.riskTier}] ${g.name} — ${g.intent}`)
    if (g.tags.length) lines.push(`            tags: ${g.tags.join(', ')}`)
  }
  return lines.join('\n')
}

/** Renders one glyph card, including whether its signature verifies. */
export function formatCard(card: GlyphCard): string {
  const c = card.cost
  return [
    `${card.name}  (${card.id.slice(0, 12)}…)`,
    `  intent:       ${card.intent}`,
    `  provider:     ${card.provider}`,
    `  risk:         ${c.riskTier} · latency ${c.latency} · ${c.sideEffects ? 'side effects' : 'no side effects'} · ${c.reversible ? 'reversible' : 'irreversible'}`,
    `  confirmation: ${c.requiresConfirmation ? 'required' : 'not required'}`,
    `  tags:         ${card.tags.join(', ') || '—'}`,
    `  signature:    ${verifyGlyph(card) ? 'OK' : 'INVALID'}`,
  ].join('\n')
}
