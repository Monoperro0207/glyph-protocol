# Tasks: Audit Fixes — Hardening Glyph Protocol

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~545 (impl ~245 + tests ~150 + docs ~120 + changesets ~30) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR1 (P0 fixes) → PR2 (P1 hardening) → PR3 (docs+hygiene+changesets) |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

#### Decision needed before apply: Yes
#### Chained PRs recommended: Yes
#### Chain strategy: feature-branch-chain (PR #1 targets fix/audit-fixes)
#### 400-line budget risk: High


### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Shared errors + all three P0 fixes (backlog cap, server callId, CT token) | PR 1 | Base: fix/audit-fixes; tests per spec scenario; independent scope |
| 2 | P1 hardening (body limit, schema guard, OpenAPI SSRF) | PR 2 | Independent of PR 1; MAJOR bump for @glyphp/adapter-openapi |
| 3 | Docs, RFC-0005, repo hygiene, changesets, final verify | PR 3 | Depends on PR 1+2 (RECEIPT_VERSION 0.3 must be committed) |

## Phase 1: Shared Foundation

- [x] 1.1 `packages/server/src/errors.ts` — Add `CONFIRMATION_BACKLOG_FULL` + `PAYLOAD_TOO_LARGE` to `GlyphErrorCode`; add `413` + `503` to `ErrorStatus`
  - Dependency for Fix 1 (503) and Fix 5A (413). Design: shared constants, no logic.

## Phase 2: P0 Fixes (PR 1 — security blockers)

- [x] 2.1 **Confirmation backlog limit** (Fix 1) — `packages/server/src/server.ts`
  - Add `MAX_PENDING_CONFIRMATIONS = 10_000` (overridable via `options.maxPendingConfirmations`), unconditional sweep, reject+503 when full.
  - Test: `packages/server/test/confirmation.test.ts` — 10_001 tickets → 503 + `Retry-After`. TDD: failing test first.
  - Specs: confirmation-backlog-limit (4 scenarios). Design decision: unconditional sweep over conditional.

- [x] 2.2 **Server-generated callId** (Fix 2) — `packages/server/src/server.ts`, `packages/types/src/types.ts`, `packages/core/test/core.test.ts`
  - `server.ts:36`: `RECEIPT_VERSION` `'0.2'` → `'0.3'`. `server.ts:~398`: `body.callId ?? randomUUID()` → always `randomUUID()`.
  - `types/src/types.ts`: Add optional `clientCallId?: string` to `CallReceipt`.
  - `core/test/core.test.ts:177`: Update hardcoded `'0.2'` → `'0.3'` in `buildReceipt()`.
  - Test: `packages/server/test/receipt.test.ts` — verify UUID v4 regardless of client input.
  - Specs: server-generated-callid (4 scenarios). Conformance: `receiptVersion` typed as `string` only — safe.
  - Design: server-owned identity for signed receipts.

- [x] 2.3 **Constant-time token check** (Fix 3) — `packages/server/src/middleware.ts`
  - Replace `.includes(token)` with SHA-256 hash + `crypto.timingSafeEqual` loop. Import `createHash`, `timingSafeEqual`.
  - Test: `packages/server/test/middleware.test.ts` — valid passes, invalid 401, different-length tokens handled safely.
  - Specs: constant-time-token-check (3 scenarios). Design: SHA-256 over HMAC (no shared secret needed).

## Phase 3: P1 Hardening (PR 2 — operational guards)

- [x] 3.1 **Body size limit** (Fix 5A) — `packages/server/src/server.ts`
  - `readJson()`: `Content-Length` check → `413 PAYLOAD_TOO_LARGE` if > 1 MiB. Stream fallback. Override via `options.maxBodyBytes`.
  - Test: `packages/server/test/runtime.test.ts` — 2 MiB POST → 413.
  - Specs: body-and-schema-limits (scenarios 1-2).

- [x] 3.2 **Schema complexity guard** (Fix 5B) — `packages/core/src/json-schema-validator.ts`
  - Add `validateSchemaComplexity()` recursive walk: max 1000 nodes / 32 depth. Throw `SCHEMA_TOO_COMPLEX` before AJV compile.
  - Test: `packages/core/test/json-schema-validator.test.ts` — 2000-node + 50-depth schemas → throw.
  - Specs: body-and-schema-limits (scenarios 3-5). Design: pre-compile (AJV doesn't expose counts).

- [x] 3.3 **OpenAPI trusted baseUrl** (Fix 4) — `packages/adapters/openapi/src/index.ts`
  - Add `allowDocumentServerUrl` (default `false`) + `allowedHosts?: string[]`. Throw SSRF error at ~51 if neither `baseUrl` nor opt-in set.
  - MAJOR semver bump. Test: `packages/adapters/openapi/test/baseurl.test.ts` — 4 scenarios.
  - Specs: openapi-trusted-baseurl (4 scenarios). Design: security > backwards compat.

## Phase 4: Documentation & Hygiene (PR 3)

- [x] 4.1 `spec/rfcs/RFC-0005-receipt-callid.md` — Follow RFC-0004 structure: Status, Author, Date, Summary, Motivation, Specification, Migration, References.
  - Specs: rfc-0005-receipt-callid (2 scenarios).

- [x] 4.2 Repo hygiene — `CODEOWNERS` (`* @Monoperro0207`), `.github/dependabot.yml` (npm, weekly, grouped), `.github/PULL_REQUEST_TEMPLATE.md` (checklist: verify, RFC, schema).
  - Read `CONTRIBUTING.md`, `GOVERNANCE.md` for existing patterns. Specs: repo-hygiene (3 scenarios).

- [x] 4.3 `ARCHITECTURE.md` (Mermaid + trust boundaries) + `docs/threat-to-tests.md` (STRIDE → test mapping).
  - Source: `spec/protocol.md`, `spec/trust.md`, `spec/security.md`, `packages/conformance/`.

- [x] 4.4 `spec/protocol.md` + `CHANGELOG-PROTOCOL.md` — Document RECEIPT_VERSION 0.3 semantic change.

## Phase 5: Changesets & Verification

- [x] 5.1 `pnpm changeset` — `@glyphp/server` (minor), `@glyphp/types` (minor), `@glyphp/core` (minor), `@glyphp/adapter-openapi` (MAJOR).

- [x] 5.2 Run `pnpm verify`, `pnpm verify:full`, `pnpm audit --prod`. All must pass.
