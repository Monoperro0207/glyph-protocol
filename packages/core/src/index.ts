import { createHash, randomUUID } from 'node:crypto'
import * as ed from '@noble/ed25519'
import type { GlyphCard, LexiconEntry, SealedEnvelope } from '@glyph/types'

// @noble/ed25519 v2 needs a sha512 implementation wired in for synchronous use.
ed.etc.sha512Sync = (...msgs: Uint8Array[]): Uint8Array => {
  const hash = createHash('sha512')
  for (const msg of msgs) hash.update(msg)
  return new Uint8Array(hash.digest())
}

const toHex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex')
const fromHex = (hex: string): Uint8Array => new Uint8Array(Buffer.from(hex, 'hex'))

// The fields that make up a glyph's identity. publicKey/signature are
// provenance, not behavior, so they are excluded — rotating keys must not
// change the id. id/createdAt are excluded by definition.
const CANONICAL_FIELDS = [
  'version',
  'name',
  'intent',
  'tags',
  'cost',
  'idempotent',
  'input',
  'output',
  'examples',
  'failureModes',
  'provider',
] as const

export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value !== null && typeof value === 'object') {
    const sorted: Record<string, unknown> = {}
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = canonicalize((value as Record<string, unknown>)[key])
    }
    return sorted
  }
  return value
}

export type GlyphKeyPair = { publicKey: string; privateKey: string }

export function computeGlyphId(
  card: Omit<GlyphCard, 'id' | 'signature' | 'createdAt' | 'publicKey'>
): string {
  const picked: Record<string, unknown> = {}
  for (const field of CANONICAL_FIELDS) {
    picked[field] = (card as Record<string, unknown>)[field]
  }
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(picked)))
    .digest('hex')
}

export function generateKeyPair(): GlyphKeyPair {
  const privateKey = ed.utils.randomPrivateKey()
  const publicKey = ed.getPublicKey(privateKey)
  return { publicKey: toHex(publicKey), privateKey: toHex(privateKey) }
}

export function signGlyph(card: GlyphCard, privateKey: string): string {
  const message = new TextEncoder().encode(card.id)
  return toHex(ed.sign(message, fromHex(privateKey)))
}

export function verifyGlyph(card: GlyphCard): boolean {
  if (!card.signature || !card.publicKey) return false
  // 1. Content integrity: the id must still match the canonical content.
  if (computeGlyphId(card) !== card.id) return false
  // 2. Provenance: the signature over the id must verify against the key.
  try {
    const message = new TextEncoder().encode(card.id)
    return ed.verify(fromHex(card.signature), message, fromHex(card.publicKey))
  } catch {
    return false
  }
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
