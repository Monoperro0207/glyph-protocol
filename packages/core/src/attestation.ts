import type { GlyphCard } from '@glyphp/types'

// ---------------------------------------------------------------------------
// Attestation verifier interface
// ---------------------------------------------------------------------------

export interface AttestationResult {
  valid: boolean
  type: string
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

export class DigestVerifier implements AttestationVerifier {
  readonly type = 'container-digest'

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

    return { valid: true, type: this.type, details: { digest } }
  }
}
