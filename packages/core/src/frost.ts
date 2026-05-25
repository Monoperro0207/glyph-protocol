/**
 * FROST threshold signer for Glyph Protocol.
 *
 * Wraps `@myecoria/frost-ed25519-blake2b-wasm` — WASM bindings to the
 * Zcash Foundation FROST reference implementation (RFC 9591). Enables
 * M-of-N threshold signing. FROST signatures are standard ed25519 —
 * consumers verify identically via {@link verify_group_signature}.
 *
 * **Status: experimental.** FROST multi-sig is opt-in. Single-key mode
 * (`Ed25519Signer`) remains the production default.
 *
 * ## Key generation (trusted dealer)
 *
 * ```ts
 * import { generate_with_dealer } from '@myecoria/frost-ed25519-blake2b-wasm'
 * const dealer = generate_with_dealer(N, M)  // max_signers, min_signers
 * ```
 *
 * ## Signing (two-round protocol)
 *
 * 1. **Round 1 — commit.** Each signer generates a nonce and commitment.
 * 2. **Round 2 — sign.** Each of M signers produces a partial signature.
 *    `policy: 'approval-required'` signers wait for external approval.
 * 3. **Aggregate.** M partial signatures → single ed25519 signature.
 *
 * @module
 */

import type { GlyphCard, CallReceipt, UpdateManifest } from '@glyphp/types'
import {
  generate_with_dealer as frostDealer,
  key_package_from_secret_share,
  round1_commit,
  round2_sign,
  create_signing_package,
  aggregate_signature,
  verify_group_signature,
  CommitmentList,
  SignatureShareList,
  type DealerKeygenResult,
  type Round1CommitResult,
} from '@myecoria/frost-ed25519-blake2b-wasm'
import { canonicalHash } from './index.js'
import type { GlyphSigner } from './signer.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A participant's secret share produced by the trusted dealer. */
export interface SignerShare {
  /** Participant index (0-based). */
  index: number
  /** Raw key package bytes (from `key_package_from_secret_share`). */
  keyPackage: Uint8Array
  /** Signing policy for this participant. */
  policy: 'auto' | 'approval-required'
}

/** A pending approval request for a human-in-the-loop signer. */
export interface ApprovalRequest {
  index: number
  nonces: Uint8Array
  signingPackage: Uint8Array
  resolve: (sig: Round1CommitResult) => void
  reject: (err: Error) => void
}

// ---------------------------------------------------------------------------
// FrostSigner
// ---------------------------------------------------------------------------

/**
 * M-of-N threshold signer using FROST (RFC 9591).
 *
 * Construct with pre-generated shares from a trusted-dealer keygen ceremony.
 *
 * ```ts
 * import { generate_with_dealer, key_package_from_secret_share } from '@myecoria/frost-ed25519-blake2b-wasm'
 * const dealer = generate_with_dealer(3, 2) // max=3, min=2
 *
 * const signer = new FrostSigner({
 *   publicKeyPackage: dealer.public_key_package,
 *   shares: [
 *     { index: 0, keyPackage: key_package_from_secret_share(dealer.share(0).secret_share), policy: 'auto' },
 *     { index: 1, keyPackage: key_package_from_secret_share(dealer.share(1).secret_share), policy: 'auto' },
 *     { index: 2, keyPackage: key_package_from_secret_share(dealer.share(2).secret_share), policy: 'approval-required' },
 *   ],
 *   threshold: 2,
 *   dealerResult: dealer,  // keep alive for cleanup
 * })
 * ```
 */
export class FrostSigner implements GlyphSigner {
  readonly publicKey: string
  readonly #publicKeyPackage: Uint8Array
  readonly #shares: SignerShare[]
  readonly #threshold: number
  readonly #dealer: DealerKeygenResult
  #pendingApprovals = new Map<number, ApprovalRequest>()

  constructor(opts: {
    /** Raw public key package from the dealer. */
    publicKeyPackage: Uint8Array
    /** N key packages (one per participant). */
    shares: SignerShare[]
    /** Minimum signers required (M). */
    threshold: number
    /** Dealer result — kept alive for the signer's lifetime. */
    dealerResult: DealerKeygenResult
  }) {
    this.#publicKeyPackage = opts.publicKeyPackage
    this.#shares = opts.shares
    this.#threshold = opts.threshold
    this.#dealer = opts.dealerResult
    this.publicKey = Buffer.from(opts.publicKeyPackage).toString('hex')
  }

  // -----------------------------------------------------------------------
  // GlyphSigner — async (full FROST protocol)
  // -----------------------------------------------------------------------

  async signGlyph(card: GlyphCard): Promise<string> {
    const msg = new TextEncoder().encode(canonicalHash(card))
    return this.#sign(msg)
  }

  async signManifest(manifest: Omit<UpdateManifest, 'signature'>): Promise<string> {
    const msg = new TextEncoder().encode(canonicalHash(manifest))
    return this.#sign(msg)
  }

  async signReceipt(receipt: Omit<CallReceipt, 'signature'>): Promise<string> {
    const msg = new TextEncoder().encode(canonicalHash(receipt))
    return this.#sign(msg)
  }

  // -----------------------------------------------------------------------
  // GlyphSigner — sync (throws — FROST requires async coordination)
  // -----------------------------------------------------------------------

  signGlyphSync(_card: GlyphCard): string {
    throw new Error('FrostSigner.signGlyphSync: FROST requires async coordination. Use signGlyph().')
  }

  signManifestSync(_manifest: Omit<UpdateManifest, 'signature'>): string {
    throw new Error(
      'FrostSigner.signManifestSync: FROST requires async coordination. Use signManifest().',
    )
  }

  // -----------------------------------------------------------------------
  // Coordinator API
  // -----------------------------------------------------------------------

  get pendingApprovals(): ReadonlyMap<number, ApprovalRequest> {
    return this.#pendingApprovals
  }

  approve(index: number, r1Result: Round1CommitResult): void {
    const req = this.#pendingApprovals.get(index)
    if (!req) throw new Error(`No pending approval for signer ${index}`)
    this.#pendingApprovals.delete(index)
    req.resolve(r1Result)
  }

  reject(index: number, reason: string): void {
    const req = this.#pendingApprovals.get(index)
    if (!req) throw new Error(`No pending approval for signer ${index}`)
    this.#pendingApprovals.delete(index)
    req.reject(new Error(reason))
  }

  /** Free WASM resources. Call when the signer is no longer needed. */
  destroy(): void {
    this.#dealer.free()
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  async #sign(message: Uint8Array): Promise<string> {
    // Round 1 — collect commitments from auto signers
    const commitments = new CommitmentList()
    const r1Results = new Map<number, Round1CommitResult>()
    const pendingR1: Promise<void>[] = []

    for (const share of this.#shares) {
      if (share.policy === 'auto') {
        const r1 = round1_commit(share.keyPackage)
        r1Results.set(share.index, r1)
        commitments.push(r1.identifier, r1.commitments)
      } else {
        pendingR1.push(
          new Promise<void>((resolve, reject) => {
            this.#pendingApprovals.set(share.index, {
              index: share.index,
              nonces: new Uint8Array(), // filled after approval
              signingPackage: new Uint8Array(), // filled after round 2 setup
              resolve: (r1: Round1CommitResult) => {
                r1Results.set(share.index, r1)
                commitments.push(r1.identifier, r1.commitments)
                resolve()
              },
              reject,
            } as ApprovalRequest)
          }),
        )
      }
    }

    if (r1Results.size < this.#threshold) {
      // Need human approvals
      // In practice, the caller monitors pendingApprovals and calls approve()
      // For now, throw if we can't meet threshold immediately
      commitments.free()
      throw new Error(
        `FrostSigner: need ${this.#threshold - r1Results.size} more approvals. ` +
          `Pending: ${[...this.#pendingApprovals.keys()].join(', ')}`,
      )
    }

    // Create signing package
    const signingPkg = create_signing_package(commitments, message)

    // Round 2 — collect M partial signatures
    const sigShares = new SignatureShareList()
    const partialCount = r1Results.size
    let collected = 0

    for (const [index, r1] of r1Results) {
      const share = this.#shares.find((s) => s.index === index)!
      const s = round2_sign(signingPkg, r1.nonces, share.keyPackage)
      sigShares.push(s.identifier, s.signature_share)
      s.free()
      collected++
      if (collected >= this.#threshold) break
    }

    // Aggregate
    const sig = aggregate_signature(signingPkg, sigShares, this.#publicKeyPackage)

    // Verify
    if (!verify_group_signature(this.#publicKeyPackage, message, sig)) {
      throw new Error('FrostSigner: aggregated signature failed verification')
    }

    // Cleanup
    for (const r1 of r1Results.values()) r1.free()
    commitments.free()
    sigShares.free()

    return Buffer.from(sig).toString('hex')
  }
}
