/**
 * @glyphp/attestation-sigstore — SPIKE
 *
 * An opt-in `AttestationVerifier` that performs **real cryptographic**
 * verification of a Sigstore bundle via `@sigstore/verify`, as opposed to the
 * structure-only `SigstoreVerifier`/`SlsaVerifier` shipped in `@glyphp/client`.
 *
 * This is the verifier RFC-0008 §4.1 step 3 calls for: it verifies the DSSE
 * signature and the certificate/key chain against an **injected** trust root,
 * and (RFC-0008 §3.2) binds the attested subject digest to the consumer's
 * expected digest. On success it returns `trusted: true` — the verdict that
 * actually opens the `requireAttestation` gate.
 *
 * It is deliberately a **separate, injected** package: `@sigstore/verify`
 * (pure-JS, ~940 KB incl. deps, no native bindings) is a dependency of *this*
 * package only, so `@glyphp/core` and `@glyphp/client` keep zero new runtime
 * dependencies. A consumer opts in by constructing one and passing it via
 * `GlyphClient`'s `attestationVerifiers: [...]`.
 *
 * Status: spike. Private, unpublished. Trust-material distribution (TUF vs.
 * pinned root) and the public-good keyless default are open questions in
 * RFC-0008 §8; here the trust material is injected by the caller.
 */

import type { AttestationResult, AttestationVerifier } from '@glyphp/core'
import type { GlyphCard } from '@glyphp/types'
import { bundleFromJSON } from '@sigstore/bundle'
import {
  type TrustMaterial,
  toSignedEntity,
  type VerificationPolicy,
  Verifier,
} from '@sigstore/verify'

export interface SigstoreBundleVerifierOptions {
  /**
   * Injected Sigstore trust material — Fulcio CA roots and/or a public-key
   * finder. Built with `@sigstore/verify`'s `toTrustMaterial(root, keys?)`.
   * Keeping this injected is what lets `@glyphp/core` stay dependency-light.
   */
  trustMaterial: TrustMaterial
  /**
   * Optional identity policy (certificate SAN / issuer) the signer must match,
   * e.g. `{ subjectAlternativeName: 'https://github.com/acme/ci/...' }`.
   * When unset, any chain-valid signer is accepted (provenance is still
   * recorded), mirroring RFC-0008 §4.1 step 5's default.
   */
  policy?: VerificationPolicy
  /**
   * Verification thresholds. Default `{ tlog: 0, ctlog: 0, timestamp: 0 }`
   * supports the injected-key / air-gapped case. For public-good keyless
   * verification you SHOULD require a transparency-log entry (`tlog: 1`).
   */
  thresholds?: { tlog?: number; ctlog?: number; timestamp?: number }
  /**
   * RFC-0008 §3.2 subject-digest binding. When set, the attestation's subject
   * digest (the in-toto statement's `subject[0].digest.sha256`) MUST equal this
   * value — the digest of the artifact that actually serves the handler. A
   * bundle lifted from another artifact fails closed.
   */
  expectedSubjectDigest?: string
}

/** Reads `subject[0].digest.sha256` out of the DSSE in-toto payload, if present. */
function extractSubjectDigest(payload: Buffer): string | undefined {
  try {
    const statement = JSON.parse(payload.toString('utf8')) as {
      subject?: Array<{ digest?: Record<string, string> }>
    }
    return statement.subject?.[0]?.digest?.sha256
  } catch {
    return undefined
  }
}

export class SigstoreBundleVerifier implements AttestationVerifier {
  readonly type = 'sigstore-bundle'

  private readonly verifier: Verifier
  private readonly policy?: VerificationPolicy
  private readonly expectedSubjectDigest?: string

  constructor(options: SigstoreBundleVerifierOptions) {
    this.verifier = new Verifier(options.trustMaterial, {
      tlogThreshold: options.thresholds?.tlog ?? 0,
      ctlogThreshold: options.thresholds?.ctlog ?? 0,
      timestampThreshold: options.thresholds?.timestamp ?? 0,
    })
    this.policy = options.policy
    this.expectedSubjectDigest = options.expectedSubjectDigest
  }

  async verify(card: GlyphCard): Promise<AttestationResult> {
    if (!card.attestation) {
      return { valid: false, type: this.type, error: 'no attestation on card' }
    }

    // The payload is a serialized Sigstore bundle (RFC-0008 §3.1 `sigstore-bundle`).
    let bundle: ReturnType<typeof bundleFromJSON>
    try {
      bundle = bundleFromJSON(JSON.parse(card.attestation.payload))
    } catch (e) {
      return {
        valid: false,
        type: this.type,
        error: `malformed Sigstore bundle: ${(e as Error).message}`,
      }
    }

    // The cryptographic check: DSSE signature + chain against the trust root.
    // This is the upgrade from structure-only validation.
    let signer: ReturnType<Verifier['verify']>
    try {
      signer = this.verifier.verify(toSignedEntity(bundle), this.policy)
    } catch (e) {
      return {
        valid: false,
        type: this.type,
        error: `cryptographic verification failed: ${(e as Error).message}`,
      }
    }

    // RFC-0008 §3.2: bind the attested subject to the serving artifact.
    let subjectDigest: string | undefined
    if (bundle.content?.$case === 'dsseEnvelope') {
      subjectDigest = extractSubjectDigest(Buffer.from(bundle.content.dsseEnvelope.payload))
    }
    if (this.expectedSubjectDigest) {
      if (!subjectDigest) {
        return {
          valid: false,
          type: this.type,
          error: 'subject-digest binding required but the bundle carries no subject digest',
        }
      }
      if (subjectDigest !== this.expectedSubjectDigest) {
        return {
          valid: false,
          type: this.type,
          error: `subject digest ${subjectDigest} does not match the pinned expected digest ${this.expectedSubjectDigest}`,
        }
      }
    }

    // Real chain passed → trusted:true, the verdict that opens the gate.
    return {
      valid: true,
      trusted: true,
      type: this.type,
      details: {
        identity: signer.identity?.subjectAlternativeName,
        issuer: signer.identity?.extensions?.issuer,
        subjectDigest,
      },
    }
  }
}
