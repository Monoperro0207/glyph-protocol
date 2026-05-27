# Tasks: Audit Phase 3 — Ecosystem & Conformance Maturity

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~805 (180 + 290 + 210 + 125) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 → PR 2 → PR 3 → PR 4 |
| Delivery strategy | ask-on-risk |
| Chain strategy | ask-always → pending user choice |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Lines | Notes |
|------|------|-----------|-------|-------|
| 1 | Threat model docs | PR 1 | ~180 | `docs/` only; no code dependency |
| 2 | Conformance internal coverage + negatives | PR 2 | ~290 | Tests only; `.test.ts` files |
| 3 | Conformance profiles feature | PR 3 | ~210 | `profiles.ts`, CLI flag, profile tests |
| 4 | Release attestation hardening | PR 4 | ~125 | `.github/workflows/release.yml`, `RELEASE.md` |

## Phase 1: Threat Model Docs (THREAT-001, 002, 003)

- [x] 1.1 Write `docs/threat-model-mcp.md` — tool-name collisions (Spoofing), malicious annotations (Tampering), schema poisoning, passthrough risks — each with STRIDE + control/test ref
- [x] 1.2 Write `docs/threat-model-openapi.md` — SSRF (Info Disclosure), schema poisoning (Tampering), malicious server URLs (Spoofing), secret leakage (Info Disclosure) — each with control/test ref
- [x] 1.3 Update `docs/threat-to-tests.md` — add MCP + OpenAPI adapter rows cross-referencing new threat model docs

## Phase 2: Conformance Internal Coverage (COV-001, COV-002)

- [ ] 2.1 Add `packages/conformance/test/execution.test.ts` — unit cover execution internals (>90% stmts)
- [ ] 2.2 Add `packages/conformance/test/security.test.ts` — unit cover security internals (>90% stmts)
- [ ] 2.3 Add `packages/conformance/test/governance.test.ts` — unit cover governance internals (>85% branches)
- [ ] 2.4 Add `packages/cli/test/import-mcp.test.ts` — importer branch coverage (non-happy paths)
- [ ] 2.5 Add negative test: auth rejection 401 → check reports failure, no false negative
- [ ] 2.6 Add negative test: rate-limit 429 → check reports condition, no crash/hang
- [ ] 2.7 Add negative test: manifest tampering → governance detects modification after signing
- [ ] 2.8 Add negative test: key registry attack → unauthorized key rejected, violation reported

## Phase 3: Conformance Profiles (CONFPROF-001, 002, 003)

- [ ] 3.1 Create `packages/conformance/src/profiles.ts` — `ConformanceProfile` type + map minimal/secure/production to level subsets + adapter-openapi/adapter-mcp gating
- [ ] 3.2 Add `ConformanceProfile` to `packages/conformance/src/types.ts` and `--profile` flag to `packages/conformance/src/cli.ts` (default `secure`)
- [ ] 3.3 Wire `--profile` flag in `packages/cli/` — pass profile to `runConformance`, map adapter profiles independently
- [ ] 3.4 Add profile gating tests: `--profile minimal` skips security/governance; `--profile production` requires governance gates; default is `secure`
- [ ] 3.5 Add adapter profile independence tests: `adapter-openapi` runs without base profiles; adapter failure doesn't block production pass

## Phase 4: Release Attestation Hardening (ATTESTPUB-001, 002)

- [ ] 4.1 Split `.github/workflows/release.yml` attestation job: `attest-core` (required, core packages only) + `attest-rest` (best-effort, non-core)
- [ ] 4.2 Add retry-once logic to `attest-core` for transient failures; on permanent failure mark release status visible, never block publish
- [ ] 4.3 Update `RELEASE.md` — consumer verification instructions for SBOM + cosign attestations on core packages
