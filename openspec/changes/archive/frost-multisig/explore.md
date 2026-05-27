## Exploration: FROST Threshold Signatures (RFC 9591) for Glyph Protocol

### Current State

Glyph Protocol 1.0 uses single-key ed25519 signing via `@noble/ed25519` v2.1.0. Key generation, signing, and verification are synchronous and single-participant:

- `generateKeyPair()` → `{ publicKey, privateKey }` (hex strings)
- `signGlyph(card, privateKey)` → hex signature over `card.id`
- `signReceipt(receipt, privateKey)` → hex signature over `canonicalHash(receipt)`
- `signManifest(manifest, privateKey)` → hex signature
- `verifyGlyph(card)` → boolean (checks id integrity + ed25519 signature)
- `verifyReceipt(receipt)` → boolean

`GlyphServer` holds one `keyPair: GlyphKeyPair` and uses it for all signing. The `KeyRegistry` stores chain-of-trust for individual key entries. Every `KeyEntry` has a single `fingerprint`/`publicKey` pair.

### Affected Areas

- **`packages/core/src/index.ts`** — All signing functions (`signGlyph`, `signReceipt`, `signManifest`) and key generation (`generateKeyPair`). Must support FROST signing path.
- **`packages/core/src/key-registry.ts`** — `KeyEntry` schema and `verifyKeyRegistry` / `buildKeyRegistry` / `resolveKey`. Must accommodate group keys.
- **`packages/server/src/server.ts`** — `GlyphServer` constructor and `register()` / `setupRoutes()`. Must accept FROST config and coordinate multi-round signing.
- **`packages/types/src/types.ts`** — `KeyEntry` and `KeyRegistry` TypeScript types. New optional fields for group key metadata.
- **`packages/core/package.json`** — New dependency: `@noble/curves` (for `ed25519_FROST`).
- **`packages/core/test/core.test.ts`** — New test cases for FROST signing variants.
- **`packages/core/test/key-registry.test.ts`** — New test cases for group key entries.
- **`spec/protocol.md`** — May need a minor section on multi-signer support (protocol 1.x additive).
- **`spec/rfcs/`** — New RFC for FROST threshold signing (RFC-0006 candidate).

### Approaches

#### 1. Add `@noble/curves` alongside `@noble/ed25519`, isolate FROST in new module

Keep existing single-key code untouched. Add `@noble/curves` as a dependency of `@glyphp/core` solely for its `ed25519_FROST` module. Create `packages/core/src/frost.ts` containing:

- `generateFrostKeys(signers: { min, max }, identifiers: Identifier[])` — trusted dealer key generation
- `FrostSignSession` class — manages two-round signing (`commit` → `signShare` → `aggregate`)
- `frostSignGlyph(session, card)`, `frostSignReceipt(session, receipt)` — convenience wrappers

Create a `GlyphSigner` interface in core that abstracts single-key vs. FROST:
```typescript
interface GlyphSigner {
  publicKey: string
  signGlyph(card: GlyphCard): Promise<string>
  signReceipt(receipt: Omit<CallReceipt, 'signature'>): Promise<string>
  signManifest(manifest: Omit<UpdateManifest, 'signature'>): Promise<string>
}
```

**Pros:**
- Zero risk to existing signing code — nothing changes for single-signer
- `@noble/curves` is audited (Cure53, Kudelski, Trail of Bits), from same author as `@noble/ed25519`
- FROST signatures ARE standard ed25519 — `verifyGlyph()` / `verifyReceipt()` need NO changes
- Wire format unchanged: `publicKey` is still 32-byte hex, signature is still 64-byte hex
- Consumers verify identically regardless of signer type

**Cons:**
- Two ed25519 libraries (~6KB extra bundle weight if tree-shaken, ~11KB if not)
- `GlyphSigner` API is async (Promise), requiring refactor of `GlyphServer.register()` and call path
- Multi-round signing means the server must coordinate with co-signers over the network — new failure modes
- `@noble/curves` FROST code is unaudited (disclosed in README: "The FROST code is new and has not been audited yet")

**Effort:** Medium

---

#### 2. Full migration from `@noble/ed25519` → `@noble/curves` for everything

Replace `@noble/ed25519` with `@noble/curves/ed25519.js` for all signing. Migrate `ed.utils.randomPrivateKey()` → `ed25519.keygen()`, `ed.sign()` → `ed25519.sign()`, etc. Then add FROST on top.

**Pros:**
- Single ed25519 dependency — smaller attack surface long-term
- Consistent API across single-key and FROST (same library)
- `@noble/curves` ed25519 has SUF-CMA + SBS non-repudiation, ZIP215 consensus mode — security upgrade over `@noble/ed25519`

**Cons:**
- `@noble/curves` v2 API is NOT a drop-in replacement for `@noble/ed25519` v2 — every signing call site changes
- Migration touches ALL signing code (core, server, tests, key-registry) — high regression risk
- No benefit to existing single-signer users; only adds migration risk
- `@noble/curves` v2 is ESM-only, Node ≥20.19 required (Glyph already requires ≥18)

**Effort:** High

---

#### 3. WASM bindings to Rust `frost-ed25519` crate

Use `@myecoria/frost-ed25519-blake2b-wasm` (0.1.4, 3 months old, 0 dependents) or build custom WASM from `frost-ed25519` crate.

**Pros:**
- Rust implementation is the reference (Zcash Foundation), battle-tested
- True DKG support from the reference implementation

**Cons:**
- Alpha-quality WASM bindings (0 dependents on npm)
- WASM build complexity in the CI/CD pipeline
- ~200KB+ WASM binary overhead
- No audit trail for WASM bindings
- Not tree-shakeable
- Overkill for a JS-native project

**Effort:** High

---

### Recommendation

**Approach 1 — Add `@noble/curves` alongside `@noble/ed25519`, isolate FROST.**

Rationale:
1. **RFC 9591 specification fidelity**: `@noble/curves` passes the imported `frost-rs` vectors and local regression tests. The trusted dealer flow matches the RFC's trusted dealer mode.
2. **Compatibility guarantee**: FROST group signatures verify with standard ed25519 verification. Glyph's `verifyGlyph()` / `verifyReceipt()` / `verifyManifest()` need NO changes. The group public key (`deal.public.commitments[0]`) is a standard ed25519 point.
3. **Minimal blast radius**: Single-signer path stays untouched. Existing 306 tests pass unchanged.
4. **Library maturity**: `@noble/curves` is audited by 3 independent firms (Cure53, Kudelski, Trail of Bits). The base ed25519 is production-grade.
5. **Graceful degradation**: If FROST code has bugs, single-signer servers are unaffected.

**Strategy**: Implement FROST as a new `GlyphSigner` strategy behind the existing `signGlyph`/`signReceipt`/`signManifest` interface. The server doesn't know which signer it has — it just calls `this.signer.signGlyph(card)`.

**KeyRegistry extension**: Add optional `groupKey` metadata to `KeyEntry`:
```typescript
interface KeyEntry {
  // ... existing fields ...
  /** Present when this key is a FROST group key */
  groupKey?: {
    threshold: { min: number; max: number }
    participants: string[]  // opaque participant identifiers
  }
}
```

### Risks

- **FROST code unaudited**: `@noble/curves` explicitly warns "The FROST code is new and has not been audited yet." For production deployment, the FROST module should undergo independent audit or wait for upstream audit. Mitigation: keep single-signer as default; FROST is opt-in and labeled experimental.
- **Signing latency**: FROST requires 2 rounds between M participants. For 2-of-3 with network round-trips of 100ms each, signing adds ~200ms per call. Mitigation: pre-commit (round 1 can happen before the message is known), keep signers co-located.
- **Coordinator complexity**: The server needs to manage session state for multi-round signing (commitment lists, signature shares). Network failures or participant unavailability during signing will produce timeouts. Mitigation: `FrostSignSession` with clear timeout and retry semantics.
- **DKG ceremony fragility**: Distributed Key Generation requires all N participants online simultaneously for 3 rounds. A failed round restarts from scratch. This is infrequent (key rotation only) but operationally demanding. Mitigation: trusted dealer mode for deployments where a single operator controls all keys.
- **Key compromise model change**: With FROST, compromising 1 of N keys doesn't break signing. But compromising a quorum does. The security model shifts from "protect one key" to "protect M of N keys." Mitigation: document the new threat model.
- **Test coverage gap**: FROST signing requires multiple participants, making unit tests harder. Mitigation: test with trusted dealer (all keys in one test), mock DKG rounds.

### Feasibility Assessment

| Criterion | Verdict |
|-----------|---------|
| Crypto library exists for JS | ✅ `@noble/curves` `ed25519_FROST` |
| Signatures compatible with existing verification | ✅ Standard ed25519 — `verifyGlyph()` unchanged |
| Wire format impact | ✅ None — `publicKey` and `signature` fields unchanged |
| Backward compatibility | ✅ Single-signer remains default and untouched |
| Key registry extensible | ✅ Additive `groupKey` field on `KeyEntry` |
| Server abstraction clean | ✅ `GlyphSigner` interface hides single/FROST |
| DKG feasible for operations | ⚠️ Trusted dealer: yes. DKG offline: yes. DKG online: complex |
| Library production-ready | ⚠️ Base ed25519: yes. FROST: unaudited — experimental label needed |

### Ready for Proposal

**Yes**, with caveat: the FROST module should be marked **experimental** in the Glyph 2.0 changelog until `@noble/curves` FROST receives an independent audit. The proposal should scope:

1. Phase 1: `GlyphSigner` abstraction + `SingleKeySigner` (refactor, no behavior change)
2. Phase 2: `FrostSigner` with trusted dealer key generation + two-round signing
3. Phase 3: KeyRegistry extensions for group keys
4. Phase 4: Server integration (opt-in `frostConfig` on `GlyphServer`)
5. Future: DKG support (post-2.0)

The `GlyphSigner` interface change is the architectural backbone — it unlocks not just FROST but any future signing scheme (HSMs, cloud KMS, hardware tokens) with zero consumer impact.
