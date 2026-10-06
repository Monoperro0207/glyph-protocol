import type { CallReceipt, GlyphCard } from '@glyphp/types'
import { canonicalHash, computeGlyphId, fromHex } from './canonical.js'
import { ed } from './ed-setup.js'

/**
 * Verifies a glyph card. Two checks, both required, mirroring
 * `@glyphp/core`'s `verifyGlyph` exactly:
 *
 * 1. **Content integrity** — the recomputed canonical id still equals `card.id`.
 * 2. **Provenance** — the ed25519 signature over `utf8(card.id)` verifies
 *    against `card.publicKey`.
 *
 * Check 1 is not optional: the signature covers only the id *string*, so
 * verifying the signature alone would accept a card whose body was swapped.
 *
 * Synchronous, and never throws — returns `false` for a missing signature or
 * public key, and for malformed hex.
 */
export function verifyGlyph(card: GlyphCard): boolean {
  if (!card.signature || !card.publicKey) return false
  if (computeGlyphId(card) !== card.id) return false
  try {
    const message = new TextEncoder().encode(card.id)
    return ed.verify(fromHex(card.signature), message, fromHex(card.publicKey))
  } catch {
    return false
  }
}

/**
 * Verifies a receipt's signature against its own embedded `serverPublicKey`.
 *
 * This is **self-consistency only** — it proves the receipt was not altered
 * after signing, and nothing else. It does not bind the receipt to a card or a
 * key you trust; that is what {@link verifyEnvelopeTrace} adds.
 */
export function verifyReceipt(receipt: CallReceipt): boolean {
  if (!receipt.signature || !receipt.serverPublicKey) return false
  const { signature, ...rest } = receipt
  try {
    const message = new TextEncoder().encode(canonicalHash(rest))
    return ed.verify(fromHex(signature), message, fromHex(receipt.serverPublicKey))
  } catch {
    return false
  }
}
