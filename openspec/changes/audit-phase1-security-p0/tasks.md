# Tasks: Audit Phase 1 — P0 Security Fixes

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~350-420 |
| 400-line budget risk | Medium |
| Chained PRs recommended | Yes |
| Suggested split | PR 1: P0-3+P0-2 → PR 2: P0-1 → PR 3: P0-4+P0-5 |
| Delivery strategy | ask-on-risk |
| Chain strategy | stacked-to-main |

Decision needed before apply: Resolved — stacked-to-main, PR 1 of 3
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: Medium

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Doc fix + core validator fail-fast | PR 1 | Foundation; adapter depends on stable validator behavior |
| 2 | OpenAPI URL redaction | PR 2 | Security fix; adapter calls validator from PR 1 |
| 3 | Client secureMode + receipt verify | PR 3 | Both touch `packages/client/src/index.ts`; independent of PR 1-2 |

## Phase 1: Documentation Fix

- [x] 1.1 Fix `spec/security.md` line 17: change "not supported" to "supported", link RFC-0001. Satisfies P0-3. ~3 lines.

## Phase 2: Core Validator Fail-Fast (TDD)

Test: `packages/core/test/json-schema-validator.test.ts` | Source: `packages/core/src/json-schema-validator.ts`

- [x] 2.1 RED: Invalid schema throws `SCHEMA_COMPILATION_FAILED` — satisfies SCHEMALIMIT-COMPILE-001 Scenario 1
- [x] 2.2 GREEN: `compileJsonSchema()` throws instead of returning `z.unknown()`
- [x] 2.3 RED+GREEN: `outputValidation: 'none'` returns passthrough + card/report flags disabled validation — satisfies Scenarios 2+3
- [x] 2.4 RED+GREEN: Valid schema compiles normally — satisfies Scenario 4
- [x] 2.5 Run `pnpm verify`; ensure adapter callers handle new throw

## Phase 3: OpenAPI URL Redaction (TDD)

Test: `packages/adapters/openapi/test/openapi.test.ts` | Source: `packages/adapters/openapi/src/index.ts`

- [ ] 3.1 RED: `api_key` in query redacted in error — satisfies OPENAPI-URLREDACT-001 Scenario 1
- [ ] 3.2 GREEN: Create `redactUrl()` helper redacting: `api_key`, `apikey`, `key`, `token`, `access_token`, `secret`, `password`, `authorization` + OpenAPI security scheme query params
- [ ] 3.3 GREEN: Wire `redactUrl()` into error construction in adapter
- [ ] 3.4 RED+GREEN: Token redacted, security scheme param redacted, non-sensitive URL unchanged, logs/traces also redacted — satisfies Scenarios 2-5
- [ ] 3.5 Run `pnpm verify`; no secret leakage in error output

## Phase 4: Client Hardening — secureMode + Receipts (TDD)

Test: `packages/client/test/client.test.ts` | Source: `packages/client/src/index.ts`

- [ ] 4.1 RED: secureMode blocks ALL changes including metadata — satisfies SECUREMODE-001 Scenarios 1-3
- [ ] 4.2 GREEN: Remove metadata auto-approval path; all changes require review in secureMode
- [ ] 4.3 RED+GREEN: `autoApproveReviewChanges: true` restores metadata-only auto-approval; content still blocked — satisfies SECUREMODE-002
- [ ] 4.4 RED: Valid receipt passes Ed25519 sig + outputHash + inspectionHash + glyphId checks — satisfies RECEIPTVERIFY-001 Scenario 1
- [ ] 4.5 GREEN: Implement `verifyReceipt()` with all 4 verification checks
- [ ] 4.6 RED+GREEN: Invalid sig, mismatched outputHash/inspectionHash/glyphId all reject — satisfies Scenarios 2-5
- [ ] 4.7 GREEN: Add `verifyReceipts` option (default `true` in secureMode); wire into client flow — satisfies RECEIPTVERIFY-002
- [ ] 4.8 Run `pnpm verify`; all 6 secureMode + 7 receipt scenarios passing
