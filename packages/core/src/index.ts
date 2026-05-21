import { createHash } from 'node:crypto'
import { randomUUID } from 'node:crypto'
import type { GlyphCard, LexiconEntry, SealedEnvelope } from '@glyph/types'

export function computeGlyphId(
  card: Omit<GlyphCard, 'id' | 'signature' | 'createdAt'>
): string {
  const canonical = JSON.stringify(card, Object.keys(card).sort())
  return createHash('sha256').update(canonical).digest('hex')
}

export function signGlyph(card: GlyphCard): string {
  return createHash('sha256').update(card.id + card.provider).digest('hex')
}

export function verifyGlyph(card: GlyphCard): boolean {
  if (!card.signature) return false
  return card.signature === signGlyph(card)
}

export function toLexiconEntry(card: GlyphCard): LexiconEntry {
  return {
    id: card.id,
    name: card.name,
    intent: card.intent,
    tags: card.tags,
    riskTier: card.cost.riskTier,
  }
}

export function applyDepth(
  card: GlyphCard,
  depth: 'minimal' | 'standard' | 'rich'
): Partial<GlyphCard> {
  if (depth === 'rich') return card

  const base: Partial<GlyphCard> = {
    id: card.id,
    name: card.name,
    intent: card.intent,
    input: card.input,
    output: card.output,
  }

  if (depth === 'standard') {
    return {
      ...base,
      cost: card.cost,
      examples: card.examples.slice(0, 2),
    }
  }

  return base
}

export function sealResult(
  glyphId: string,
  callId: string,
  payload: unknown,
  latencyMs: number,
  provider: string
): SealedEnvelope {
  return {
    type: 'data',
    glyphId,
    callId: callId || randomUUID(),
    payload,
    meta: {
      latencyMs,
      provider,
      timestamp: new Date().toISOString(),
    },
  }
}
