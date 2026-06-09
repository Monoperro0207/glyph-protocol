# RFC-0006: FROST Threshold Signatures

- **Status**: Withdrawn (2026-06-09)
- **Author**: Patrick Espino
- **Date**: 2026-05-25

> **Withdrawal note (2026-06-09).** The `FrostSigner` implementation this RFC
> describes was removed from `@glyphp/core`. An external audit, confirmed by
> testing, found the premise below ("FROST signatures are standard ed25519")
> did not hold for the implementation: `@myecoria/frost-ed25519-blake2b-wasm`
> uses a BLAKE2b challenge hash, so its group signatures **never verify under
> RFC 8032 ed25519** (`verifyGlyph`/`verifyReceipt`), only under its own
> `verify_group_signature`. Additionally, it signed `canonicalHash(card)`
> while the protocol signs `card.id`, and the published package never exposed
> the module (no `./frost` export), so no npm consumer could have used it.
> The standard-ciphersuite alternative evaluated (`@frosts/ed25519`,
> FROST(Ed25519, SHA-512) per RFC 9591) is self-described as an unaudited
> learning project and its published dists fail at import time (they require
> `vitest` at runtime), so it is not shippable either.
>
> The design below remains valid for a future implementation: the
> `GlyphSigner` interface and `GlyphServer.registerAsync` are the seams. A
> revived implementation MUST produce signatures over `card.id` that verify
> under RFC 8032 against a 32-byte group verifying key exposed as
> `GlyphSigner.publicKey`, and MUST be covered by tests that assert
> `verifyGlyph`/`verifyReceipt`/`verifyManifest` pass.

## Summary

Add FROST threshold signatures (RFC 9591) as an opt-in multi-signer layer. M of N signers must collaborate to produce a valid ed25519 signature. Zero wire-format change — FROST signatures are standard ed25519 indistinguishable from single-key signatures.

## Motivation

Glyph Protocol v1.0 has a single point of trust: one ed25519 key pair signs every card, manifest, and receipt. If that key is compromised, the entire trust model collapses. For a protocol that sells "don't trust, verify," having a single signing authority is a tension that limits adoption in high-assurance environments (healthcare, finance, legal).

FROST (Flexible Round-Optimized Schnorr Threshold) solves this by distributing signing authority across N participants, any M of whom can collaboratively produce a valid signature. No single participant holds the full private key. No single compromise breaks the trust model.

## Specification

### Key generation (trusted dealer)

Key generation uses the Zcash Foundation FROST reference implementation via WASM bindings (`@myecoria/frost-ed25519-blake2b-wasm`). A one-time offline trusted dealer produces:

- `group_public_key`: 32-byte ed25519 group public key
- `N` secret shares, one per participant
- A public key package used during signing and verification

```ts
import { generate_with_dealer } from '@myecoria/frost-ed25519-blake2b-wasm'
const dealer = generate_with_dealer(3, 2) // max_signers=3, min_signers=2
```

The dealer result is ephemeral — the private shares are distributed to participants and the dealer's state is destroyed. DKG (Distributed Key Generation, no trusted dealer) is deferred to a future protocol version.

### Signing (two-round protocol)

FROST uses a two-round protocol per signature:

1. **Round 1 — Commit.** Each of M participating signers generates a nonce pair and publishes a commitment.
2. **Round 2 — Sign.** Each signer produces a partial signature using its secret share, its nonce, the full commitment list, and the message.

The coordinator aggregates M partial signatures into a single ed25519 signature indistinguishable from a single-key signature.

### GlyphSigner interface

The signing abstraction introduced in this RFC (`GlyphSigner`) decouples the server from any specific signing implementation:

```ts
interface GlyphSigner {
  readonly publicKey: string
  signGlyph(card: GlyphCard): Promise<string>
  signGlyphSync(card: GlyphCard): string  // single-key only
  signManifest(manifest: Omit<UpdateManifest, 'signature'>): Promise<string>
  signManifestSync(manifest: Omit<UpdateManifest, 'signature'>): string
  signReceipt(receipt: Omit<CallReceipt, 'signature'>): Promise<string>
}
```

Implementations:

| Signer | Keys | Behaviour |
|--------|------|-----------|
| `Ed25519Signer` | 1 | Current single-key behaviour (default, 0 changes) |
| `FrostSigner` | N (threshold M) | Two-round FROST protocol with auto + human-in-the-loop policies |

### Human-in-the-loop

A `FrostSigner` participant can be configured with `policy: 'approval-required'`. When such a participant is needed for a signing round, the coordinator creates a pending approval request. An external system (human operator, CI pipeline, HSM) calls `signer.approve(index)` or `signer.reject(index, reason)` to proceed.

This enables production deployments where a CI/CD pipeline auto-signs low-risk operations but a human must approve high-risk ones (key rotation, manifest publication).

### Key registry

The `KeyRegistry` gains an optional `group` field on `KeyEntry` to record multi-signer metadata:

```ts
interface KeyEntry {
  // ... existing fields
  group?: {
    threshold: number      // M (minimum signers)
    participants: number   // N (total signers)
  }
}
```

A group key entry is treated identically to a single key entry for rotation and revocation — the group key signs the next entry in the chain.

## Wire format

**No changes.** FROST produces standard ed25519 signatures. `GlyphCard.signature`, `CallReceipt.signature`, and `UpdateManifest.signature` remain 64-byte hex-encoded ed25519 signatures. `GlyphCard.publicKey` remains a 32-byte hex public key (the FROST group public key).

Consumers verify with standard `ed25519.verify()` — they do not know or need to know whether the signature came from 1 key or a 3-of-5 threshold.

## Verification

```ts
import { verify_group_signature } from '@myecoria/frost-ed25519-blake2b-wasm'

// Same as ed25519.verify(sig, msg, groupPublicKey)
const valid = verify_group_signature(publicKeyPackage, message, signature)
```

## Compatibility

- **Backward compatible.** `Ed25519Signer` is the default. Existing servers and consumers unchanged.
- **Forward compatible.** FROST signatures verify as standard ed25519. Future signers implement the same interface.
- **Opt-in.** Multi-signer mode requires explicit construction of a `FrostSigner` and passing it to `GlyphServer`.

## Migration

No migration required for existing deployments. To adopt multi-signer:

1. Run the trusted-dealer keygen ceremony offline.
2. Distribute shares to N participants.
3. Construct a `FrostSigner` and pass it to `GlyphServer({ signer })`.
4. Publish the group public key in the key registry.

Existing consumers verify signatures identically — they see no difference.

## Security considerations

- **Trusted-dealer assumption.** The dealer knows all secret shares and could sign unilaterally. The dealer ceremony must be run in an air-gapped environment and its state destroyed afterward. DKG (eliminating the trusted dealer) is planned for a future version.
- **@noble/curves unaudited.** The initial exploration used `@noble/curves` ed25519_FROST but its aggregation path had issues in v2.2.0. The production implementation uses `@myecoria/frost-ed25519-blake2b-wasm`, WASM bindings to the Zcash Foundation reference implementation.
- **Two-round latency.** Each FROST signature requires two network round-trips between the coordinator and M signers (~200ms for 2-of-3 local). This is acceptable for card registration and manifest publication (infrequent operations) but may be noticeable for per-call receipt signing in high-throughput scenarios.
- **Partial signature nonces.** Nonces are single-use. Reuse would leak the secret share. The `FrostSigner` zeroes nonces after use to prevent accidental reuse.

## References

- [RFC 9591 — FROST: Flexible Round-Optimized Schnorr Threshold Signatures](https://www.rfc-editor.org/rfc/rfc9591)
- [Zcash Foundation FROST](https://github.com/ZcashFoundation/frost)
- [@myecoria/frost-ed25519-blake2b-wasm](https://www.npmjs.com/package/@myecoria/frost-ed25519-blake2b-wasm)
- `packages/core/src/signer.ts` — GlyphSigner interface
- `packages/core/src/frost.ts` — FrostSigner implementation
