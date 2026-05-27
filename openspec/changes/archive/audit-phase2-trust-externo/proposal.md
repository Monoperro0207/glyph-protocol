# Proposal: Audit Phase 2 — External Trust & Production Hardening

## Intent

Glyph's cryptographic integrity (signing, hashing, receipts) is solid, but no mechanism exists to verify what code produced a card, who owns the signer key, or whether a server was deployed securely. Phase 2 builds the trust layer above integrity.

## Scope

### In Scope
- P1-1: Attestation verifier plug-ins (Sigstore, SLSA, container digest) with client-side policy per risk tier
- P1-2: Federated provider trust registry — org → keys → policies → conformance, with genesis-key pinning and revocation
- P1-3: Production hardening — mandatory auth, rate limit, stable key, pin store when `NODE_ENV=production`

### Out of Scope
- P2 audit findings, UI/dashboard, cross-chain attestation, real-time revocation distribution

## Capabilities

### New Capabilities
- `attestation-verification`: Pluggable verifiers for Sigstore bundle, SLSA provenance, container digest. Client can require attestation above configurable risk tier. Cards without attestation remain valid.
- `provider-trust-registry`: Federated registry mapping org identity → ed25519 keys → trust policies → conformance reports. Genesis-key pinning, per-org trust without per-tool pinning, filesystem + HTTP discovery.
- `production-defaults-hardening`: `local-dev` profile (unchanged) + `production` profile. Production startup MUST fail if auth, rate limit, stable key pair, or pin store are missing. Scaffold generates hardened defaults.

### Modified Capabilities
None — existing specs cover internal security. External trust is additive.

## Approach

Bottom-up layering: P1-3 (hardened server) → P1-1 (attestation plug-ins) → P1-2 (federated registry). Each item independently verifiable. Test-first. Escape hatches (`GLYPH_SKIP_*` flags) prevent breakage.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/core/` | Modified | `verifyAttestation()` → plug-in registry |
| `packages/client/` | Modified | Attestation policy per risk tier; trust-registry resolution |
| `packages/server/` | Modified | Production startup hardening |
| `packages/types/` | Modified | Trust registry types, verifier interface |
| `packages/cli/` | Modified | Scaffold hardened production config |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Attestation verifier rejects attestation-free cards | Low | Skip verification path; explicit policy knob |
| Registry becomes centralized bottleneck | Medium | Federated design; filesystem + HTTP fallback |
| Hardening breaks existing deploys | Low | `GLYPH_SKIP_HARDENING` opt-out; `local-dev` unchanged |

## Rollback Plan

Each P1 isolated to 2-3 files. Revert individual commits. Production hardening only active under `NODE_ENV=production`.

## Dependencies

None. Builds on Phase 1 foundations.

## Success Criteria

- [ ] P1-1: Sigstore attestation verifies; attestation-free cards pass at low tier; tampered attestation rejected
- [ ] P1-2: Client trusts org by key — no per-tool pinning; unregistered provider rejected when policy requires
- [ ] P1-3: Production start rejects missing auth/rate-limit/key/pin-store; `local-dev` unchanged
