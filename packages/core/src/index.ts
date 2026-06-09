import { createHash, randomUUID } from 'node:crypto'
import type {
  CallReceipt,
  CardAttestation,
  CardDiff,
  CardFieldChange,
  GlyphCard,
  LexiconEntry,
  Sanitization,
  SanitizationFinding,
  SealedEnvelope,
  UpdateManifest,
} from '@glyphp/types'
import * as ed from '@noble/ed25519'

// @noble/ed25519 needs a sha512 implementation wired in for synchronous use.
// v3 types hashes.sha512 as `undefined | (msg) => bytes`, so this assigns directly.
// Uint8Array.from copies into a fresh ArrayBuffer-backed view, matching the
// `Uint8Array<ArrayBuffer>` return type noble expects (digest() is ArrayBufferLike).
ed.hashes.sha512 = (msg: Uint8Array) => {
  return Uint8Array.from(createHash('sha512').update(msg).digest())
}

const toHex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex')
const fromHex = (hex: string): Uint8Array => new Uint8Array(Buffer.from(hex, 'hex'))

// The fields that make up a glyph's identity. publicKey/signature are
// provenance, not behavior, so they are excluded — rotating keys must not
// change the id. id/createdAt are excluded by definition. `attestation` is
// behavior-defining (it commits to a specific build), so it enters the id;
// when absent (the common case today) JSON.stringify drops the undefined
// value, so a card without an attestation hashes identically to a 0.2-era
// card — the addition is backwards-compatible.
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
  'requiredScopes',
  'attestation',
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
  card: Omit<GlyphCard, 'id' | 'signature' | 'createdAt' | 'publicKey'>,
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
  const privateKey = ed.utils.randomSecretKey()
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

// How each card field is treated when it changes between an approved card and
// a new one. 'breaking' fields gate execution (need human re-approval);
// 'review' fields are descriptive. publicKey is included because the protocol
// id deliberately excludes it, yet a key swap is provenance-critical.
const FIELD_SEVERITY: Record<string, CardFieldChange['severity']> = {
  version: 'breaking',
  name: 'review',
  intent: 'review',
  tags: 'review',
  'cost.latency': 'review',
  'cost.sideEffects': 'breaking',
  'cost.reversible': 'breaking',
  'cost.riskTier': 'breaking',
  'cost.requiresConfirmation': 'breaking',
  idempotent: 'breaking',
  input: 'breaking',
  output: 'breaking',
  examples: 'review',
  failureModes: 'review',
  provider: 'breaking',
  requiredScopes: 'breaking',
  publicKey: 'breaking',
  attestation: 'breaking',
}

const canonEqual = (a: unknown, b: unknown): boolean =>
  JSON.stringify(canonicalize(a)) === JSON.stringify(canonicalize(b))

/**
 * Compares an approved card against a newly seen one and classifies every
 * difference. The content-addressed id is the *detector* — any canonical
 * change already flips it; this diff is the *explainer* a human uses to triage
 * whether the change is safe to re-approve. Pure.
 */
export function diffCards(approved: GlyphCard, next: GlyphCard): CardDiff {
  const changes: CardFieldChange[] = []
  const record = (field: string, before: unknown, after: unknown): void => {
    if (!canonEqual(before, after)) {
      changes.push({
        field,
        severity: FIELD_SEVERITY[field] ?? 'review',
        before,
        after,
      })
    }
  }

  record('version', approved.version, next.version)
  record('name', approved.name, next.name)
  record('intent', approved.intent, next.intent)
  record('tags', approved.tags, next.tags)
  for (const k of [
    'latency',
    'sideEffects',
    'reversible',
    'riskTier',
    'requiresConfirmation',
  ] as const) {
    record(`cost.${k}`, approved.cost?.[k], next.cost?.[k])
  }
  record('idempotent', approved.idempotent, next.idempotent)
  record('input', approved.input, next.input)
  record('output', approved.output, next.output)
  record('examples', approved.examples, next.examples)
  record('failureModes', approved.failureModes, next.failureModes)
  record('provider', approved.provider, next.provider)
  record('requiredScopes', approved.requiredScopes, next.requiredScopes)
  record('publicKey', approved.publicKey, next.publicKey)
  record('attestation', approved.attestation, next.attestation)

  return {
    changed: changes.length > 0,
    idChanged: approved.id !== next.id,
    keyChanged: approved.publicKey !== next.publicKey,
    changes,
    requiresApproval: changes.some((c) => c.severity === 'breaking'),
  }
}

/** Canonical SHA-256 of any JSON value — order-independent. */
export function canonicalHash(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex')
}

/** Signs a call receipt with the server's ed25519 private key. */
export function signReceipt(receipt: Omit<CallReceipt, 'signature'>, privateKey: string): string {
  const message = new TextEncoder().encode(canonicalHash(receipt))
  return toHex(ed.sign(message, fromHex(privateKey)))
}

/** Verifies a receipt's signature against its embedded serverPublicKey. */
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

/** Signs an update manifest with the server's ed25519 private key. */
export function signManifest(
  manifest: Omit<UpdateManifest, 'signature'>,
  privateKey: string,
): string {
  const message = new TextEncoder().encode(canonicalHash(manifest))
  return toHex(ed.sign(message, fromHex(privateKey)))
}

/** Verifies a manifest's signature against its embedded serverPublicKey. */
export function verifyManifest(manifest: UpdateManifest): boolean {
  if (!manifest.signature || !manifest.serverPublicKey) return false
  const { signature, ...rest } = manifest
  try {
    const message = new TextEncoder().encode(canonicalHash(rest))
    return ed.verify(fromHex(signature), message, fromHex(manifest.serverPublicKey))
  } catch {
    return false
  }
}

/**
 * Verifies an attestation envelope is *well-formed*. This is deliberately
 * limited: a real attestation must be checked against an external trust root
 * (Sigstore registry, GitHub OIDC, SLSA verifier, etc.) that the consumer
 * already trusts. The SDK cannot certify its own host, so it cannot produce
 * or fully verify an attestation on its own. A consumer that has a verifier
 * for a particular `type` should plug it in by inspecting `attestation` and
 * calling its own logic — this function checks only the shape and signals
 * which formats are recognised.
 *
 * Returns `{ ok, recognized }`:
 *   - `ok` — the envelope has the required fields and non-empty payload.
 *   - `recognized` — whether the `type` is one the SDK has a known schema
 *     for. `false` is not a failure; it means the consumer must bring its
 *     own verifier for that format.
 */
export function verifyAttestation(attestation: CardAttestation | undefined): {
  ok: boolean
  recognized: boolean
} {
  if (!attestation) return { ok: false, recognized: false }
  const ok =
    typeof attestation.type === 'string' &&
    attestation.type.length > 0 &&
    typeof attestation.payload === 'string' &&
    attestation.payload.length > 0
  const KNOWN_TYPES = new Set(['sigstore-bundle', 'slsa-provenance', 'in-toto'])
  return { ok, recognized: ok && KNOWN_TYPES.has(attestation.type) }
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
  depth: 'minimal' | 'standard' | 'rich',
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
  provider: string,
  inspection?: Sanitization,
): SealedEnvelope {
  const envelope: SealedEnvelope = {
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
  if (inspection) envelope.inspection = inspection
  return envelope
}

// Code-point ranges that carry no legitimate meaning for an LLM consumer but
// are classic vehicles for hiding instructions inside "inert" tool output.
// Built numerically from code points so this file — a sanitizer — stays free
// of the very characters it strips. Control chars preserve tab/newline/return.
const STRIP_CLASSES: ReadonlyArray<{
  kind: SanitizationFinding['kind']
  ranges: ReadonlyArray<readonly [number, number]>
}> = [
  { kind: 'unicode-tags', ranges: [[0xe0000, 0xe007f]] },
  {
    kind: 'zero-width',
    ranges: [
      [0x200b, 0x200d],
      [0xfeff, 0xfeff],
    ],
  },
  {
    kind: 'bidi-override',
    ranges: [
      [0x202a, 0x202e],
      [0x2066, 0x2069],
    ],
  },
  {
    kind: 'control-char',
    ranges: [
      [0x00, 0x08],
      [0x0b, 0x0c],
      [0x0e, 0x1f],
      [0x7f, 0x9f],
    ],
  },
]

const buildRegex = (ranges: ReadonlyArray<readonly [number, number]>): RegExp => {
  const body = ranges
    .map(([lo, hi]) =>
      lo === hi ? `\\u{${lo.toString(16)}}` : `\\u{${lo.toString(16)}}-\\u{${hi.toString(16)}}`,
    )
    .join('')
  return new RegExp(`[${body}]`, 'gu')
}

const STRIP_REGEXES: ReadonlyArray<{
  kind: SanitizationFinding['kind']
  re: RegExp
}> = STRIP_CLASSES.map(({ kind, ranges }) => ({ kind, re: buildRegex(ranges) }))

// JSON Pointer (RFC 6901) token escaping, so a finding's path is unambiguous.
const escapeToken = (key: string): string => key.replace(/~/g, '~0').replace(/\//g, '~1')

function sanitizeString(input: string, path: string, findings: SanitizationFinding[]): string {
  let s = input
  for (const { kind, re } of STRIP_REGEXES) {
    const matches = s.match(re)
    if (matches && matches.length > 0) {
      findings.push({ path, kind, count: matches.length })
      s = s.replace(re, '')
    }
  }

  const normalized = s.normalize('NFKC')
  if (normalized !== s) {
    let count = 0
    for (const cp of s) if (cp.normalize('NFKC') !== cp) count++
    findings.push({ path, kind: 'nfkc-normalized', count: count || 1 })
    s = normalized
  }
  return s
}

function sanitizeValue(value: unknown, path: string, findings: SanitizationFinding[]): unknown {
  if (typeof value === 'string') return sanitizeString(value, path, findings)
  if (Array.isArray(value)) {
    return value.map((item, i) => sanitizeValue(item, `${path}/${i}`, findings))
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value as Record<string, unknown>)) {
      out[key] = sanitizeValue(
        (value as Record<string, unknown>)[key],
        `${path}/${escapeToken(key)}`,
        findings,
      )
    }
    return out
  }
  return value
}

/**
 * Strips provably-invisible / dangerous characters (Unicode tags, zero-width,
 * bidi overrides, C0/C1 control chars) and applies NFKC normalization to every
 * string in a JSON value. Returns the cleaned value plus a deterministic
 * report of what was removed. Pure and idempotent: sanitizing an
 * already-clean value reports `modified: false`.
 */
export function sanitize(value: unknown): {
  value: unknown
  report: Sanitization
} {
  const findings: SanitizationFinding[] = []
  const cleaned = sanitizeValue(value, '', findings)
  findings.sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0,
  )
  return { value: cleaned, report: { modified: findings.length > 0, findings } }
}

export type { AttestationResult, AttestationVerifier } from './attestation.js'
export {
  AttestationVerifierRegistry,
  DigestVerifier,
} from './attestation.js'
export type { CompileJsonSchemaOptions } from './json-schema-validator.js'
export { compileJsonSchema, SchemaCompilationError } from './json-schema-validator.js'
export type { KeyRegistrySource, ResolveResult } from './key-registry.js'
export {
  buildKeyEntry,
  buildKeyRegistry,
  FileKeyRegistry,
  fingerprintKey,
  HttpKeyRegistry,
  KEY_REGISTRY_VERSION,
  resolveKey,
  StaticKeyRegistry,
  verifyKeyRegistry,
} from './key-registry.js'
export type { KeylessBackend, KeylessBundle, KeylessIdentityPolicy } from './keyless.js'
export { KeylessVerifier } from './keyless.js'
export {
  PROVIDERS_REGISTRY_VERSION,
  signProvidersRegistry,
  verifyProvidersRegistry,
} from './providers-registry.js'
export type { GlyphSigner } from './signer.js'
export { Ed25519Signer } from './signer.js'
