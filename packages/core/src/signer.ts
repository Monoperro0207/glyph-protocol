import type { CallReceipt, GlyphCard, UpdateManifest } from '@glyphp/types'
import { signGlyph, signManifest, signReceipt } from './index.js'

/**
 * Abstraction over the cryptographic signing of glyph cards, manifests, and
 * call receipts.
 *
 * The GlyphServer delegates all signing through this interface. The default
 * {@link Ed25519Signer} preserves the current single-key ed25519 behavior.
 * Pluggable implementations (threshold/KMS/HSM-backed signers) can produce
 * signatures without changing the wire format, as long as the result verifies
 * as a standard RFC 8032 ed25519 signature over the same message.
 *
 * Async-only signers (e.g. one that coordinates remote key material) may not
 * support the sync path — implement the sync variants by throwing. The sync
 * variants (`signGlyphSync`, `signManifestSync`) exist so that
 * {@link GlyphServer.register} and {@link GlyphServer.registerManifest}
 * remain synchronous for the common single-key case; async signers use
 * `GlyphServer.registerAsync` instead.
 */
export interface GlyphSigner {
  readonly publicKey: string

  signGlyph(card: GlyphCard): Promise<string>
  signGlyphSync(card: GlyphCard): string

  signManifest(manifest: Omit<UpdateManifest, 'signature'>): Promise<string>
  signManifestSync(manifest: Omit<UpdateManifest, 'signature'>): string

  signReceipt(receipt: Omit<CallReceipt, 'signature'>): Promise<string>
}

// ---------------------------------------------------------------------------
// Ed25519Signer — single-key (current behaviour, extracted)
// ---------------------------------------------------------------------------

export class Ed25519Signer implements GlyphSigner {
  readonly publicKey: string
  readonly #privateKey: string

  constructor(keyPair: { publicKey: string; privateKey: string }) {
    this.publicKey = keyPair.publicKey
    this.#privateKey = keyPair.privateKey
  }

  async signGlyph(card: GlyphCard): Promise<string> {
    return this.signGlyphSync(card)
  }

  signGlyphSync(card: GlyphCard): string {
    return signGlyph(card, this.#privateKey)
  }

  async signManifest(manifest: Omit<UpdateManifest, 'signature'>): Promise<string> {
    return this.signManifestSync(manifest)
  }

  signManifestSync(manifest: Omit<UpdateManifest, 'signature'>): string {
    return signManifest(manifest, this.#privateKey)
  }

  async signReceipt(receipt: Omit<CallReceipt, 'signature'>): Promise<string> {
    return signReceipt(receipt, this.#privateKey)
  }
}
