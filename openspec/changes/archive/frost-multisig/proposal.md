# Proposal: FROST Multisig

## Intent

Eliminate the single-key trust bottleneck. Current signing requires one private key — compromise it, lose everything. FROST (RFC 9591) enables M-of-N threshold signing where no single key suffices. Signatures are standard ed25519, zero wire-format change. Opt-in, additive, backward-compatible.

## Scope

### In Scope
- **GlyphSigner interface** — extract signing behind `publicKey`, `signGlyph`, `signReceipt`, `signManifest`
- **Ed25519Signer** — preserves current single-key behavior as default
- **FrostSigner** — M-of-N threshold via `@noble/curves` `ed25519_FROST` with trusted-dealer keygen and two-round signing
- **Async approval callbacks** — human-in-the-loop signer support
- **KeyRegistry group key metadata** — optional `groupKey` on `KeyEntry` with threshold + participants
- **RFC-0006** — protocol documentation, `trust.md` multi-sig posture update
- **Experimental label** — FROST module marked experimental until audited

### Out of Scope
- Online DKG (use offline ceremony)
- Consumer/verifier changes (signatures are standard ed25519)
- Wire protocol or card/receipt type changes

## Capabilities

### New Capabilities
- `glyph-signer-abstraction`: Pluggable signing interface decoupling key type from signature production. `Ed25519Signer` is default; `FrostSigner` is first extension.
- `frost-threshold-signing`: M-of-N FROST signing via `@noble/curves`. Trusted-dealer keygen, two-round commit-sign-aggregate, sync/async approval callbacks.
- `key-registry-group-keys`: Optional `groupKey` metadata on `KeyEntry` carrying threshold params and participant identifiers for verification chain resolution.

### Modified Capabilities
None — no existing signed spec covers signing or key management.

## Approach

Add `@noble/curves` alongside existing `@noble/ed25519`. Zero migration: single-signer path untouched. `GlyphServer` receives `signer: GlyphSigner` option, defaults to `Ed25519Signer`. `FrostSigner` wraps `ed25519_FROST` module with session management for two-round signing. Verify functions unchanged — FROST outputs standard ed25519 signatures.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/core/src/signer.ts` | New | `GlyphSigner` interface + `Ed25519Signer` |
| `packages/core/src/frost.ts` | New | `FrostSigner`, `FrostSignSession`, keygen |
| `packages/core/src/index.ts` | Modified | Re-export signer symbols |
| `packages/server/src/server.ts` | Modified | Accept `signer` option |
| `packages/types/src/types.ts` | Modified | `KeyEntry.groupKey` field |
| `packages/core/src/key-registry.ts` | Modified | Handle group key metadata |
| `spec/rfcs/` | New | RFC-0006 |
| `spec/trust.md` | Modified | Multi-sig threat posture |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| `@noble/curves` FROST unaudited | Medium | Experimental label; single-signer default; opt-in only |
| Multi-round signing latency (~200ms) | Low | Pre-commit before message; co-locate signers |
| Coordinator state complexity | Medium | `FrostSignSession` with timeout/retry semantics |
| DKG ceremony fragility | Low | Trusted dealer for phase 1; DKG deferred |

## Rollback Plan

Remove `packages/core/src/frost.ts` and `packages/core/src/signer.ts`. Revert `GlyphServer` to direct key-pair injection. Remove `@noble/curves` dependency. No database migrations, no wire-format changes — pure code revert.

## Dependencies

- `@noble/curves` (new, `packages/core`)

## Success Criteria

- [ ] 306 existing tests pass unchanged (Ed25519Signer default)
- [ ] 2-of-3 FROST sign produces verifiable ed25519 signature
- [ ] `verifyGlyph()`/`verifyReceipt()` accept FROST signatures without changes
- [ ] Key registry resolves group-key entries correctly
- [ ] RFC-0006 approved and merged
