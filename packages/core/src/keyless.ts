import { createHash } from 'node:crypto'
import type { GlyphCard } from '@glyphp/types'
import type { AttestationResult, AttestationVerifier } from './attestation.js'
import { computeGlyphId } from './index.js'

/**
 * The keyless provenance bundle carried (base64-encoded) in
 * `card.attestation.payload` for `type: 'glyph-keyless-v1'`. See RFC-0007 §3.1.
 */
export interface KeylessBundle {
  bundleVersion: 'glyph-keyless-v1'
  /**
   * SHA-256 (hex) of the card's **attestation-exclusive** canonical id
   * ({@link keylessSubjectDigest}) — binds bundle ↔ card content. The bundle
   * lives inside `card.attestation`, so it cannot commit to the final id that
   * contains it (RFC-0007 §3.1).
   */
  subjectDigest: string
  /** The OIDC issuer that minted the signing identity. */
  issuer: string
  /** The human-meaningful provenance identity, e.g. `repo:acme/tools:ref:...`. */
  identity: string
  /** Sigstore-style ephemeral signing certificate (PEM). Opaque to Glyph. */
  signingCertificate?: string
  /** Transparency-log inclusion proof. Opaque to Glyph. */
  logEntry?: { logIndex: number; logId: string; inclusionProof: string }
}

/** Consumer policy over which provenance identities to trust (RFC-0007 §4.2.3). */
export interface KeylessIdentityPolicy {
  /**
   * Allowed issuers — exact match, or a prefix that ends at a segment
   * boundary (`:` or `/`). Empty/undefined ⇒ any issuer.
   */
  issuers?: string[]
  /**
   * Allowed identities — exact match, or a prefix that ends at a segment
   * boundary (`:` or `/`): `repo:acme/tools` matches itself and
   * `repo:acme/tools:ref:...`, but never `repo:acme/tools-evil`.
   * Empty/undefined ⇒ any identity.
   */
  identities?: string[]
}

/**
 * Backend that performs the cryptographic half of keyless verification — the
 * certificate-chain and transparency-log check (RFC-0007 §4.2.2). Glyph does
 * not reimplement Sigstore; a consumer injects this, defaulting to none. When
 * absent, a bundle is structurally validated but never marked trusted.
 */
export interface KeylessBackend {
  verifyBundle(
    bundle: KeylessBundle,
    card: GlyphCard,
  ): Promise<{ trusted: boolean; error?: string }>
}

const KEYLESS_TYPE = 'glyph-keyless-v1'

/**
 * The digest a keyless bundle commits to: SHA-256 (hex) of the card's
 * **attestation-exclusive** canonical id — the id `computeGlyphId` yields with
 * the `attestation` slot absent (RFC-0007 §3.1). The bundle rides inside
 * `card.attestation`, which itself enters the final id, so committing to
 * `sha256(card.id)` would need a sha256 fixed point; excluding the slot that
 * carries the proof mirrors how the ed25519 path signs an id that excludes
 * `signature`. For a card without an attestation this equals `sha256(card.id)`.
 *
 * Producers call this on the card content *before* attaching the attestation;
 * verifiers recompute it from the received card (never from `card.id`).
 */
export function keylessSubjectDigest(
  card: Omit<GlyphCard, 'id' | 'signature' | 'createdAt' | 'publicKey'> | GlyphCard,
): string {
  const preId = computeGlyphId({ ...card, attestation: undefined })
  return createHash('sha256').update(preId).digest('hex')
}

const SEGMENT_DELIMITERS = new Set([':', '/'])

function matchesAny(value: string, allow: string[] | undefined): boolean {
  if (!allow || allow.length === 0) return true // unconstrained
  return allow.some((a) => {
    if (value === a) return true
    if (a.length === 0 || !value.startsWith(a)) return false
    // A bare prefix would widen authorization: `repo:acme/tools` must not
    // admit `repo:acme/tools-evil`. A prefix only matches when it ends at a
    // segment boundary — the allow entry itself ends with a delimiter, or the
    // next character of the candidate value is one.
    return (
      SEGMENT_DELIMITERS.has(a[a.length - 1] as string) ||
      SEGMENT_DELIMITERS.has(value[a.length] as string)
    )
  })
}

/**
 * Verifies a `glyph-keyless-v1` attestation (RFC-0007). It performs the parts
 * that need no external dependency — bundle parsing, the subject-digest binding
 * (so a bundle cannot be replayed onto another card), and identity-policy
 * matching — and **delegates** the certificate/transparency-log check to an
 * injected {@link KeylessBackend}. Without a backend the attestation is
 * `valid` (well-formed and bound) but `trusted: false`: structural recognition
 * without false confidence, mirroring `verifyAttestation`'s recognized/trusted
 * split. Registers like any other {@link AttestationVerifier}.
 */
export class KeylessVerifier implements AttestationVerifier {
  readonly type = KEYLESS_TYPE
  private policy?: KeylessIdentityPolicy
  private backend?: KeylessBackend

  constructor(options?: { policy?: KeylessIdentityPolicy; backend?: KeylessBackend }) {
    this.policy = options?.policy
    this.backend = options?.backend
  }

  async verify(card: GlyphCard): Promise<AttestationResult> {
    const attestation = card.attestation
    if (!attestation || attestation.type !== KEYLESS_TYPE) {
      return { valid: false, type: KEYLESS_TYPE, error: 'not a glyph-keyless-v1 attestation' }
    }

    // Parse the base64 JSON bundle.
    let bundle: KeylessBundle
    try {
      const json = Buffer.from(attestation.payload, 'base64').toString('utf8')
      bundle = JSON.parse(json) as KeylessBundle
    } catch {
      return { valid: false, type: KEYLESS_TYPE, error: 'malformed keyless bundle' }
    }
    if (bundle.bundleVersion !== KEYLESS_TYPE || typeof bundle.subjectDigest !== 'string') {
      return { valid: false, type: KEYLESS_TYPE, error: 'unsupported or incomplete bundle' }
    }

    // Subject binding — the bundle must commit to THIS card's content
    // (RFC-0007 §4.2.1). Recomputed from the attestation-exclusive canonical
    // id, never read from `card.id`: the bundle lives inside `attestation`,
    // so it cannot commit to the final id that contains it. Content integrity
    // of `card.id` itself remains `verifyGlyph`'s check (RFC-0007 §3.2).
    const expected = keylessSubjectDigest(card)
    if (bundle.subjectDigest !== expected) {
      return {
        valid: false,
        type: KEYLESS_TYPE,
        error: 'subject digest does not match card content',
      }
    }

    // The bundle is well-formed and bound to this card. Trust now depends on
    // (a) the crypto backend confirming cert+log, and (b) the identity policy.
    const policyOk =
      matchesAny(bundle.issuer, this.policy?.issuers) &&
      matchesAny(bundle.identity, this.policy?.identities)

    let cryptoTrusted = false
    let backendError: string | undefined
    if (this.backend) {
      const r = await this.backend.verifyBundle(bundle, card)
      cryptoTrusted = r.trusted
      backendError = r.error
    }

    const details = { issuer: bundle.issuer, identity: bundle.identity, policyOk }
    return {
      valid: true,
      type: KEYLESS_TYPE,
      trusted: cryptoTrusted && policyOk,
      details,
      ...(backendError ? { error: backendError } : {}),
    }
  }
}
