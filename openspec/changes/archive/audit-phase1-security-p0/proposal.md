# Proposal: Audit Phase 1 — P0 Security Fixes

## Intent

Fix 5 P0 security audit findings: secret leakage in OpenAPI errors, silent schema validation bypass, contradictory key revocation docs, secureMode auto-approval loophole, and missing client-side receipt verification. Each is an exploitable gap in a signed tool-contract protocol.

## Scope

### In Scope
- P0-1: `redactUrl()` helper — redact secrets in OpenAPI adapter error messages
- P0-2: Fail-fast when schema compilation fails; explicit `outputValidation: 'none'` opt-out
- P0-3: Fix `spec/security.md` line 17 — key revocation IS supported
- P0-4: `secureMode` blocks ALL auto-approvals; `autoApproveReviewChanges: true` restores old behavior
- P0-5: Auto-verify receipts in strict client (signature, outputHash, inspectionHash, glyphId)

### Out of Scope
- P1/P2 audit findings
- Non-audit hardening
- Protocol-level signing changes

## Capabilities

### New Capabilities
- `secure-mode-strict-enforcement`: secureMode refuses ALL changes unless explicitly approved. Metadata-only changes (intent, examples, tags) require review. `autoApproveReviewChanges: true` opt-in restores prior behavior.
- `client-receipt-verification`: Strict client auto-verifies receipts — Ed25519 signature, `outputHash` vs payload, `inspectionHash` vs inspection, `glyphId` vs approved card. `verifyReceipts: true` default in secureMode.

### Modified Capabilities
- `openapi-trusted-baseurl`: Redact query params matching `api_key`, `apikey`, `key`, `token`, `access_token`, `secret`, `password`, `authorization`, plus OpenAPI scheme security params, from error messages.
- `body-and-schema-limits`: `compileJsonSchema()` MUST throw `SCHEMA_COMPILATION_FAILED` instead of returning `z.unknown()`. Passthrough only via `outputValidation: 'none'`. Card/report MUST flag disabled validation.

## Approach

Surgical, test-first across 4 packages. Each P0 independently verifiable and revertible. Opt-in escape hatches avoid breaking consumers.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/adapters/openapi/src/index.ts` | Modified | URL redaction in HTTP errors |
| `packages/core/src/json-schema-validator.ts` | Modified | Fail-fast instead of `z.unknown()` |
| `packages/client/src/index.ts` | Modified | secureMode strict + receipt verification |
| `spec/security.md` | Modified | Correct revocation claim |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| P0-2 breaks adapters relying on passthrough | Low | `outputValidation: 'none'` escape hatch |
| P0-4 breaks CI auto-approving metadata PRs | Low | `autoApproveReviewChanges: true` |
| P0-5 adds receipt processing latency | Low | Async verify, strict mode only |

## Rollback Plan

Each P0 is isolated to one file. Revert individual commits. Opt-in flags preserve old defaults for consumers who need them.

## Dependencies

None. All fixes are self-contained.

## Success Criteria

- [ ] P0-1: API key in query + upstream 500 does not leak secret in error output
- [ ] P0-2: Invalid schema throws at adapt-time, never silently degrades
- [ ] P0-3: No doc claims revocation unsupported; RFC-0001 linked as source of truth
- [ ] P0-4: secureMode blocks metadata-only auto-approvals; opt-in restores old behavior
- [ ] P0-5: Altered payload, altered inspection, wrong-key receipts all rejected
