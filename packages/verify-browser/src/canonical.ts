import type { GlyphCard } from '@glyphp/types'
import * as ed from '@noble/ed25519'
import { sha256 } from '@noble/hashes/sha2.js'

/**
 * The fields that make up a glyph's identity — the browser-side mirror of the
 * (module-private) `CANONICAL_FIELDS` in `@glyphp/core`.
 *
 * `publicKey`/`signature` are provenance, not behavior, so they are excluded:
 * rotating keys must not change the id. `id`/`createdAt` are excluded by
 * definition. `attestation` is behavior-defining, so it enters the id; when
 * absent, `JSON.stringify` drops the undefined value, so a card without an
 * attestation hashes identically to a 0.2-era card.
 *
 * Exported here (core keeps it private) because a browser verifier has to be
 * auditable: a reader must be able to see what is covered. Drift against core
 * is caught by the mutation property test in `test/differential.test.ts`, which
 * is a stronger guarantee than sharing a constant would be.
 */
export const CANONICAL_FIELDS = [
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
  'requiredScopes',
  'attestation',
] as const

/** Recursively sorts object keys. Byte-identical to `@glyphp/core`'s. */
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

/** Hex encoding, via ed25519's own helpers — no `Buffer`. */
export const toHex = (bytes: Uint8Array): string => ed.etc.bytesToHex(bytes)
export const fromHex = (hex: string): Uint8Array => ed.etc.hexToBytes(hex)

const sha256Hex = (text: string): string => toHex(sha256(new TextEncoder().encode(text)))

/** Canonical SHA-256 of any JSON value — order-independent. */
export function canonicalHash(value: unknown): string {
  return sha256Hex(JSON.stringify(canonicalize(value)))
}

/**
 * The card's content-addressed id: SHA-256 over the canonical JSON of the
 * canonical fields only. Missing fields are written as `undefined` and dropped
 * by `JSON.stringify`, exactly as core does.
 */
export function computeGlyphId(
  card: Omit<GlyphCard, 'id' | 'signature' | 'createdAt' | 'publicKey'>,
): string {
  const picked: Record<string, unknown> = {}
  for (const field of CANONICAL_FIELDS) {
    picked[field] = (card as Record<string, unknown>)[field]
  }
  return sha256Hex(JSON.stringify(canonicalize(picked)))
}
