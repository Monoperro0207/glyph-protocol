import type { AttestationVerifier, AttestationResult } from '@glyphp/core'
import type { GlyphCard } from '@glyphp/types'

// ---------------------------------------------------------------------------
// SigstoreVerifier — validates Sigstore bundle structure (DSSE envelope)
// ---------------------------------------------------------------------------

interface SigstoreBundle {
  mediaType?: string
  verificationMaterial?: unknown
  messageSignature?: unknown
}

export class SigstoreVerifier implements AttestationVerifier {
  readonly type = 'sigstore'

  async verify(card: GlyphCard): Promise<AttestationResult> {
    if (!card.attestation) {
      return { valid: false, type: this.type, error: 'no attestation on card' }
    }

    let parsed: SigstoreBundle
    try {
      parsed = JSON.parse(card.attestation.payload) as SigstoreBundle
    } catch {
      return { valid: false, type: this.type, error: 'invalid JSON payload' }
    }

    if (!parsed.mediaType) {
      return { valid: false, type: this.type, error: 'missing mediaType in Sigstore bundle' }
    }

    if (!parsed.verificationMaterial) {
      return {
        valid: false,
        type: this.type,
        error: 'missing verificationMaterial in Sigstore bundle',
      }
    }

    if (!parsed.messageSignature) {
      return {
        valid: false,
        type: this.type,
        error: 'missing messageSignature in Sigstore bundle',
      }
    }

    // Extract OIDC identity from certificate when available.
    let identity: string | undefined
    let issuer: string | undefined
    const vm = parsed.verificationMaterial as Record<string, unknown>
    if (vm.certificate) {
      const cert = vm.certificate as Record<string, unknown>
      if (typeof cert.rawBytes === 'string') {
        identity = 'certificate-present'
        // Full OIDC identity extraction requires x509 parsing —
        // the rawBytes field contains the DER-encoded certificate.
      }
    }

    return {
      valid: true,
      type: this.type,
      details: {
        mediaType: parsed.mediaType,
        identity,
        issuer,
        limitation:
          'structure-only validation — full cryptographic verification requires sigstore-js dependency',
      },
    }
  }
}

// ---------------------------------------------------------------------------
// SlsaVerifier — validates SLSA Provenance v1.0 structure
// ---------------------------------------------------------------------------

const SLSA_PREDICATE_TYPE = 'https://slsa.dev/provenance/v1'

interface SlsaProvenance {
  predicateType?: string
  predicate?: {
    builder?: { id?: string }
    buildDefinition?: unknown
    [key: string]: unknown
  }
  subject?: Array<{
    name?: string
    digest?: Record<string, string>
  }>
}

export class SlsaVerifier implements AttestationVerifier {
  readonly type = 'slsa'

  async verify(card: GlyphCard): Promise<AttestationResult> {
    if (!card.attestation) {
      return { valid: false, type: this.type, error: 'no attestation on card' }
    }

    let parsed: SlsaProvenance
    try {
      parsed = JSON.parse(card.attestation.payload) as SlsaProvenance
    } catch {
      return { valid: false, type: this.type, error: 'invalid JSON payload' }
    }

    if (parsed.predicateType !== SLSA_PREDICATE_TYPE) {
      return {
        valid: false,
        type: this.type,
        error: `expected predicateType "${SLSA_PREDICATE_TYPE}", got "${parsed.predicateType ?? 'undefined'}"`,
      }
    }

    if (!parsed.predicate?.builder?.id) {
      return { valid: false, type: this.type, error: 'missing builder.id in SLSA predicate' }
    }

    if (!parsed.subject || parsed.subject.length === 0) {
      return { valid: false, type: this.type, error: 'missing or empty subject array in SLSA provenance' }
    }

    // Validate subject[0].digest has sha256
    const subject0 = parsed.subject[0]
    if (!subject0.digest?.sha256) {
      return {
        valid: false,
        type: this.type,
        error: 'subject[0].digest.sha256 is missing — full digest validation requires external verifier',
      }
    }

    return {
      valid: true,
      type: this.type,
      details: {
        builder: parsed.predicate.builder.id,
        buildType: parsed.predicate.buildDefinition
          ? (parsed.predicate.buildDefinition as Record<string, unknown>).buildType
          : undefined,
        subject: {
          name: subject0.name,
          digest: subject0.digest,
        },
      },
    }
  }
}
