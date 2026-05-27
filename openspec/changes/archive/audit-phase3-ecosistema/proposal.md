# Proposal: Audit Phase 3 — Ecosystem & Conformance Maturity

## Intent

Phase 1 (5 P0) and Phase 2 (3 P1) merged. Phase 3 closes remaining gaps: conformance is binary with no deployment profiles, adapter boundaries lack threat models, conformance internals are lightly tested, and release attestations are best-effort. Deployments need self-certifying tiers; consumers need verifiable provenance.

## Scope

### In Scope
- Conformance profiles: `minimal`, `secure`, `production`, `adapter-openapi`, `adapter-mcp`
- Threat model docs + STRIDE-to-test mapping for MCP and OpenAPI adapters
- Unit tests for conformance internals (`execution`, `security`, `governance`) + negative paths (auth rejection, 429, manifest tampering, key-registry attacks)
- SBOM + cosign required post-publish status for core packages; non-core stays best-effort; visible workflow failure on core attestation failure

### Out of Scope
- Wire-protocol changes, new conformance checks, adapter implementation changes, npm publish pipeline

## Capabilities

### New Capabilities
- `conformance-profiles`: Tiered profiles so deployments self-certify at the tier matching their threat model
- `conformance-coverage`: Unit tests for conformance internals and negative security paths; >90% statement, >85% branch
- `adapter-threat-model`: STRIDE threat models for MCP adapter (tool-name collisions, malicious annotations, schema poisoning) and OpenAPI adapter (SSRF, secret leakage, malicious URLs); each with controls and tests
- `release-attestation`: SBOM + cosign are required post-publish status for core packages; failure marks the workflow/release incomplete

### Modified Capabilities
- None

## Approach

- **Profiles**: `profiles.ts` composing existing levels; `--profile` flag defaults to `secure`
- **Coverage**: Tests in `packages/conformance/test/`, `packages/cli/test/`
- **Threat models**: Two docs extending existing STRIDE mapping
- **Attestations**: Split `release.yml` into core (required) and non-core (best-effort)

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/conformance/src/` | Mod | Profile composition + CLI flag |
| `packages/conformance/test/` | Ext | Internals + negative-path tests |
| `packages/cli/test/` | Mod | Importer tests |
| `docs/threat-model-{mcp,openapi}.md` | New | Adapter threat models |
| `.github/workflows/release.yml` | Mod | Required vs best-effort attestation |
| `RELEASE.md`, `SECURITY.md` | Mod | Verification instructions |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Profile flag breaks existing CLI | Low | No flag = all levels (current behavior) |
| Attestation blocks release on transient failure | Low | npm publish cannot be rolled back automatically; core attestation failure marks the workflow/release incomplete for follow-up rerun |

## Rollback Plan

- Revert `release.yml` to `continue-on-error: true` for all packages
- Remove `--profile` flag; conformance runs all levels by default
- Threat model docs are additive — no rollback needed

## Dependencies

- None

## Success Criteria

- [ ] `pnpm conformance:self --profile minimal|secure|production` passes
- [ ] Coverage >= 90% statements, >= 85% branches
- [ ] Two threat model docs with STRIDE rows + test mapping
- [ ] Core attestation fail → release marked; non-core → best-effort warning
