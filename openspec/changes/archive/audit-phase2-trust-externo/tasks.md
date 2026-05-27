# Tasks: Audit Phase 2 — External Trust & Production Hardening

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 700–800 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 (P1-3 ~120) → PR 2 (P1-1 core ~150) → PR 3 (P1-1 client ~190) → PR 4 (P1-2 ~250) |
| Delivery strategy | ask-on-risk |
| Chain strategy | stacked-to-main |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Production hardening (P1-3) | PR 1 | `strictProduction` guard + scaffold; base: main |
| 2 | Attestation core interface + DigestVerifier (P1-1) | PR 2 | Interface in core, DigestVerifier; base: main |
| 3 | Attestation client verifiers + wiring (P1-1) | PR 3 | Sigstore/SLSA in client, policy enforcement; base: main |
| 4 | Provider trust registry (P1-2) | PR 4 | Types, discovery, enforcement, genesis pinning; base: main |

## Phase 1: Production Hardening (P1-3)

- [x] 1.1 `packages/server/src/server.ts`: Add `strictProduction?: boolean` to `GlyphServerOptions`. When `NODE_ENV=production` and `strictProduction: true`, constructor throws if auth, rateLimit, keyPair/signer, or keyRegistry are missing. When `strictProduction: false`, logs warnings instead. [PRODHARDEN-001]
- [x] 1.2 `packages/server/test/hardening.test.ts`: Add tests: production with all configs → success; missing auth → throw; missing rateLimit → throw; `strictProduction: false` → warns and starts; non-production env → skip checks. [PRODHARDEN-001]
- [x] 1.3 `packages/cli/src/commands/init.ts`: Update `PRODUCTION_SERVER` scaffold template to include `strictProduction: true` in the `GlyphServer` constructor call. [PRODHARDEN-002]
- [x] 1.4 `packages/cli` scaffold smoke test: Verify `glyph init production-server` output includes `strictProduction: true` and passes TSC. [PRODHARDEN-002]

## Phase 2: Attestation Core Interface (P1-1 core)

- [ ] 2.1 `packages/core/src/attestation.ts`: Create new file. Define `AttestationVerifier` interface (`type`, `verify(card): Promise<AttestationResult>`), `AttestationVerifierRegistry` class (register/get), and `DigestVerifier` class (`sha256:` regex match). Export from module. [ATTESTVERIFY-001]
- [ ] 2.2 `packages/core/src/index.ts`: Export `AttestationVerifier`, `AttestationVerifierRegistry`, `DigestVerifier` from new attestation module. [ATTESTVERIFY-001]
- [ ] 2.3 `packages/core/test/attestation.test.ts`: Add unit tests: DigestVerifier `sha256:` match → valid; mismatch → invalid; unsupported type → unknown; registry returns correct verifier. [ATTESTVERIFY-001]

## Phase 3: Attestation Client Verifiers (P1-1 client)

- [ ] 3.1 `packages/client/src/attestation.ts`: Create new file. Implement `SigstoreVerifier` and `SlsaVerifier` factory functions. Both return `AttestationVerifier` interface. Sigstore deps optional — `unknown` status on missing dep. [ATTESTVERIFY-001]
- [ ] 3.2 `packages/client/src/index.ts`: Add `attestation?: { verifiers?: AttestationVerifier[], policy: 'none' | 'danger' | 'all' }` to `GlyphClientOptions`. Wire policy check into `ensureApproved()`: `none` → skip; `danger` → reject if riskTier=danger + attestation invalid; `all` → reject if !valid. [ATTESTVERIFY-002]
- [ ] 3.3 `packages/client/test/attestation.test.ts`: Create. Test: policy `none` accepts unattested; `danger` rejects high-risk without attestation; `danger` accepts safe without attestation; `all` rejects unattested; `all` accepts valid attestation; tampered attestation → rejected. [ATTESTVERIFY-002]

## Phase 4: Provider Trust Registry (P1-2)

- [ ] 4.1 `packages/types/src/types.ts`: Add `AttestationResult` (status, type, identity?, details?) and `ProviderTrustEntry` (org, genesis, keys: KeyEntry[], policies?) types. [ATTESTVERIFY-001] [TRUSTREG-003]
- [ ] 4.2 `packages/client/src/trust.ts`: Create. Implement `ProviderTrustResolver` class: HTTP `/.well-known/glyph-trust` → filesystem `.glyph-trust.json` fallback → per-tool pin. Reuses `verifyKeyRegistry()` for genesis chain validation. [TRUSTREG-001] [TRUSTREG-003]
- [ ] 4.3 `packages/client/src/index.ts`: Add `trust?: ProviderTrustResolver` to `GlyphClientOptions`. Wire enforcement into `ensureApproved()`: when resolver configured + policy requires registration, reject unregistered providers. [TRUSTREG-002]
- [ ] 4.4 `packages/client/test/trust.test.ts`: Create. Test: HTTP discovery succeeds; filesystem fallback on 404; no registry → per-tool pin; genesis key pinned; valid key rotation accepted; rotation without genesis chain rejected; unregistered provider rejected per policy. [TRUSTREG-001] [TRUSTREG-002] [TRUSTREG-003]
