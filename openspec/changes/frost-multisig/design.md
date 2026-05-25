# Design: FROST Multisig

## Technical Approach

Extract signing behind a `GlyphSigner` interface; keep existing `@noble/ed25519` code intact as `Ed25519Signer` (default). Add `@noble/curves` for `ed25519_FROST` inside a new `FrostSigner` — produces standard ed25519 signatures, zero wire format change. `GlyphServer` receives an optional `signer` option, defaults to `Ed25519Signer`. Consumers and verifiers are untouched.

## Architecture Decisions

| Decision | Option | Tradeoff | Choice |
|----------|--------|----------|--------|
| **Interface extraction** | Standalone `signer.ts` module | Keeps index.ts clean; isolates signing concern. Risk: import churn. | New `packages/core/src/signer.ts` — `GlyphSigner` + `Ed25519Signer` |
| **FROST library** | `@noble/curves` vs WASM vs `frost-rs` | noble: audited base, same author, 6KB. WASM: ~200KB, alpha bindings. | `@noble/curves` — additive dep, no migration |
| **Async `signGlyph`** | `Promise<string>` vs keep sync | Async needed for FROST multi-round + approval callbacks. Existing callers are already in async methods. | Make `signGlyph`/`signReceipt` async — zero caller breakage |
| **Keygen mode** | Trusted dealer vs DKG | Dealer: simple, offline, one-time. DKG: multi-round protocol, future. | Trusted dealer for phase 1; DKG deferred |
| **Server backward compat** | `signer?` option vs mandatory refactor | Optional preserves `keyPair` path; `signer` takes precedence when both provided. | Add `signer?: GlyphSigner` to constructor; keyPair fallback unchanged |

## Data Flow

```
GlyphServer.register()
     │
     ▼
this.signer.signGlyph(card)
     │
     ├── Ed25519Signer: ed.sign(message, privateKey) → hex
     │
     └── FrostSigner:
           1. Hash card.id → message
           2. For each share:
               ├─ policy "auto" → partial sig
               └─ policy "approval-required" → onApprovalRequired(index)
           3. Collect M partials → frost.aggregate() → hex
```

Verification path unchanged: `verifyGlyph()`/`verifyReceipt()` use `@noble/ed25519.verify()` against the signer's `publicKey` (group key for FROST, standard ed25519 point).

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `packages/core/src/signer.ts` | Create | `GlyphSigner` interface + `Ed25519Signer` class |
| `packages/core/src/frost.ts` | Create | `FrostSigner` class, `SignerShare`/`PartialSignature` types, keygen helper |
| `packages/core/src/index.ts` | Modify | Re-export new symbols; deprecate standalone `signGlyph`/`signReceipt` (keep for existing callers) |
| `packages/server/src/server.ts` | Modify | Add `signer?: GlyphSigner` option; delegate to `this.signer` |
| `packages/types/src/types.ts` | Modify | Add `groupKey?: { threshold: {min,max}; participants: string[] }` to `KeyEntry` |
| `packages/core/src/key-registry.ts` | Modify | `entrySigningPayload` includes `groupKey` in canonical hash |
| `packages/core/package.json` | Modify | Add `@noble/curves` dependency |
| `packages/core/test/signer.test.ts` | Create | Ed25519Signer identity, FrostSigner 2-of-3 aggregation |
| `packages/core/test/frost.test.ts` | Create | Threshold enforcement, policy callbacks, bad partial rejection |
| `packages/core/test/key-registry.test.ts` | Modify | Group key resolve, rotation with group entries |
| `spec/rfcs/RFC-0006-frost-multisig.md` | Create | Protocol RFC |
| `spec/trust.md` | Modify | Multi-sig threat posture update |

## Interfaces / Contracts

```ts
// packages/core/src/signer.ts
export interface GlyphSigner {
  readonly publicKey: string
  signGlyph(card: GlyphCard): Promise<string>
  signReceipt(receipt: Omit<CallReceipt, 'signature'>): Promise<string>
  signManifest(manifest: Omit<UpdateManifest, 'signature'>): Promise<string>
}

// packages/core/src/frost.ts
export type SignerShare = {
  index: number; share: Uint8Array; policy: 'auto' | 'approval-required'
}
export type PartialSignature = { index: number; sig: Uint8Array }

export class FrostSigner implements GlyphSigner {
  constructor(opts: {
    groupPublicKey: string; shares: SignerShare[]; threshold: number;
    onApprovalRequired?: (index: number) => Promise<boolean>
  })
}

// KeyEntry extension (types.ts)
// Add: groupKey?: { threshold: { min: number; max: number }; participants: string[] }
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | Ed25519Signer produces valid sigs | `node:test` — same pattern as `core.test.ts` |
| Unit | FrostSigner 2-of-3 aggregates correctly | In-memory trusted-dealer keygen, 3 shares, verify aggregated sig |
| Unit | FrostSigner rejects < M partials | 2-of-3 setup, collect only 1 partial → expect error |
| Unit | Auto vs approval-required policy | Mock `onApprovalRequired`; assert auto skips callback, approval waits |
| Integration | Group key registry resolve + rotate | Build registry with `groupKey` entries, verify chain-of-trust |
| Regression | 306 existing tests pass | Ed25519Signer default in server — zero behavior change |

## Migration / Rollout

No migration required. `GlyphServer` falls back to `Ed25519Signer` when no `signer` option is passed — existing deployments continue unchanged. `FrostSigner` is opt-in and marked experimental. `@noble/curves` added as a peer-dep-level optional for `core`. No wire, database, or config format changes.

## Open Questions

- [ ] Should `FrostSigner` sessions be persistent (survive server restart) or ephemeral? Ephemeral is simpler for phase 1.
- [ ] `@noble/curves` FROST audit status — track upstream; currently marked experimental.
