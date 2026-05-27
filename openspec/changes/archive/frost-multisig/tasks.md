# Tasks: FROST Multisig

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~480 (new ~400, modified ~80) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1: Phase 1+2 (~400 lines), PR 2: Phase 3+4 (~80 lines) |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Signer abstraction + FrostSigner core | PR 1 | Ed25519Signer default; FrostSigner 2-of-3; all 306 tests pass |
| 2 | Key registry group keys + docs | PR 2 | KeyEntry.groupKey; RFC-0006; trust.md; final verify |

## Phase 1: GlyphSigner abstraction

- [ ] 1.1 Create `packages/core/src/signer.ts` — `GlyphSigner` interface (`publicKey`, `signGlyph`, `signReceipt`, `signManifest` all async) + `Ed25519Signer` class wrapping `@noble/ed25519`
- [ ] 1.2 Refactor `packages/server/src/server.ts` — accept `signer?: GlyphSigner` in constructor; default to `Ed25519Signer` from existing `keyPair`; delegate all signing to `this.signer`
- [ ] 1.3 Update `packages/core/src/index.ts` — re-export `GlyphSigner`, `Ed25519Signer`; keep standalone `signGlyph`/`signReceipt`/`signManifest` functions for existing callers
- [ ] 1.4 Create `packages/core/test/signer.test.ts` — Ed25519Signer: sign card → `verifyGlyph()` passes; default server path unchanged

## Phase 2: FrostSigner

- [ ] 2.1 Add `@noble/curves` dependency — `pnpm add @noble/curves -w` in `packages/core`
- [ ] 2.2 Create `packages/core/src/frost.ts` — `FrostSigner` class (`GlyphSigner`); `SignerShare`/`PartialSignature` types; trusted-dealer keygen helper; two-round commit→signShare→aggregate via `ed25519_FROST`
- [ ] 2.3 Create `packages/core/test/frost.test.ts` — 2-of-3 sign → `verifyGlyph()` with group public key; < M partials rejected; `auto` skips callback, `approval-required` awaits `onApprovalRequired`
- [ ] 2.4 Run full test suite — `pnpm test`; all 306 tests pass with zero regressions

## Phase 3: Key registry + docs

- [ ] 3.1 Add optional `groupKey` to `KeyEntry` in `packages/types/src/types.ts` — `{ threshold: { min, max }; participants: string[] }`
- [ ] 3.2 Update `packages/core/src/key-registry.ts` `entrySigningPayload()` — include `groupKey` in canonical hash when present
- [ ] 3.3 Add group key tests to `packages/core/test/key-registry.test.ts` — resolve group key as `active`; rotation chain with group entries verifies
- [ ] 3.4 Write `spec/rfcs/RFC-0006-frost-multisig.md` — FROST signing model, keygen ceremony, two-round protocol, trust assumptions, experimental label
- [ ] 3.5 Update `spec/trust.md` multi-sig posture + `CHANGELOG-PROTOCOL.md` — FROST entry with experimental flag

## Phase 4: Full verification

- [ ] 4.1 Run `pnpm verify:full` — typecheck + tests + build + conformance pass
- [ ] 4.2 Run `pnpm check` — Biome lint + format clean
- [ ] 4.3 Run `pnpm coverage` — no regression below current ~83%
