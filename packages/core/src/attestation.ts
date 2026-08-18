import type { GlyphCard } from '@glyphp/types'

// ---------------------------------------------------------------------------
// Attestation verifier interface
// ---------------------------------------------------------------------------

export interface AttestationResult {
  valid: boolean
  type: string
  trusted?: boolean
  details?: Record<string, unknown>
  error?: string
}

export interface AttestationVerifier {
  readonly type: string
  verify(card: GlyphCard): Promise<AttestationResult>
}

// ---------------------------------------------------------------------------
// AttestationVerifierRegistry — maps attestation types to verifiers
// ---------------------------------------------------------------------------

export class AttestationVerifierRegistry {
  private verifiers = new Map<string, AttestationVerifier>()

  register(verifier: AttestationVerifier): void {
    this.verifiers.set(verifier.type, verifier)
  }

  get(type: string): AttestationVerifier | undefined {
    return this.verifiers.get(type)
  }

  list(): string[] {
    return Array.from(this.verifiers.keys())
  }
}

// ---------------------------------------------------------------------------
// DigestVerifier — validates container image sha256 digests
// ---------------------------------------------------------------------------

const DIGEST_RE = /^sha256:[a-f0-9]{64}$/

export interface DigestVerifierOptions {
  /**
   * RFC-0008 §3.2 subject-digest binding. When set, the attested digest MUST
   * equal this value — the digest of the image that actually serves the
   * handler for this card. A digest lifted from another artifact fails closed.
   *
   * When unset, this verifier checks the digest's *format* only. That answers
   * "is this a well-formed digest envelope?", never "does it describe *this*
   * deployment?" — so an unbound result is necessary but not sufficient.
   *
   * Format: `sha256:<64 lowercase hex>`.
   */
  expectedDigest?: string
}

/**
 * Verifies a `container-digest` attestation: the sha256 digest of the image
 * serving the handler behind a card.
 *
 * Construct it with `expectedDigest` to get a security control. Without one it
 * validates *format* only and reports `trusted: false`, which keeps it out of
 * the `requireAttestation` gate — an unbound digest is a provider self-claim,
 * not evidence about this deployment (RFC-0008 §3.2).
 */
export class DigestVerifier implements AttestationVerifier {
  readonly type = 'container-digest'

  private readonly expectedDigest?: string

  constructor(options: DigestVerifierOptions = {}) {
    this.expectedDigest = options.expectedDigest
  }

  async verify(card: GlyphCard): Promise<AttestationResult> {
    if (!card.attestation) {
      return { valid: false, type: this.type, error: 'no attestation' }
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(card.attestation.payload)
    } catch {
      return { valid: false, type: this.type, error: 'invalid JSON payload' }
    }

    if (typeof parsed !== 'object' || parsed === null || !('digest' in parsed)) {
      return { valid: false, type: this.type, error: 'payload missing digest field' }
    }

    const digest = (parsed as Record<string, unknown>).digest
    if (typeof digest !== 'string') {
      return { valid: false, type: this.type, error: 'digest must be a string' }
    }

    if (!DIGEST_RE.test(digest)) {
      return {
        valid: false,
        type: this.type,
        error: `invalid digest format: expected sha256:<64 hex chars>, got "${digest}"`,
      }
    }

    // RFC-0008 §3.2 — bind the attested digest to the artifact the consumer
    // pinned for this card. Without this, a well-formed digest for *some other*
    // artifact passes.
    if (this.expectedDigest && digest !== this.expectedDigest) {
      return {
        valid: false,
        type: this.type,
        error: `digest ${digest} does not match the pinned expected digest ${this.expectedDigest}`,
        details: { digest, expectedDigest: this.expectedDigest },
      }
    }

    // An unbound digest is a provider self-claim: structurally well-formed, but
    // backed by no external evidence and tied to no consumer pin. It does not
    // establish that *this* deployment is the attested one, so it must not open
    // the `requireAttestation` gate (RFC-0008 §4.1 step 4, §6).
    if (!this.expectedDigest) {
      return {
        valid: true,
        trusted: false,
        type: this.type,
        details: {
          digest,
          subjectBound: false,
          limitation:
            'format-only validation — set expectedDigest to bind this digest to the serving artifact (RFC-0008 §3.2)',
        },
      }
    }

    return {
      valid: true,
      trusted: true,
      type: this.type,
      details: { digest, subjectBound: true },
    }
  }
}
