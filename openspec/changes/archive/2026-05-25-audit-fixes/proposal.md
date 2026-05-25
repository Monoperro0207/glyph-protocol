# Proposal: Audit Fixes — Hardening Glyph Protocol to ≥9.0

## Intent

Fix 5 security/correctness findings from external audit (8.4/10 → ≥9.0 signal). Defensive hardening only — no new features, no refactors. Each fix independently testable and revertible.

## Scope

### In Scope

**P0 — blocks public promotion:**
- Hard cap `pendingConfirmations` (MAX 10_000 + unconditional sweep + 503 with `Retry-After`)
- Server-generated `callId` (always `randomUUID()`, optional `clientCallId`, RECEIPT_VERSION 0.3)
- Constant-time token comparison (SHA-256 + `timingSafeEqual`)

**P1 — operational hardening:**
- OpenAPI adapter baseUrl trust (opt-in `allowDocumentServerUrl` + `allowedHosts`, MAJOR bump)
- Body size limit (1 MiB, 413) + schema complexity guard (1000 nodes / 32 depth)

**P1 — repo hygiene:**
- `CODEOWNERS`, `.github/dependabot.yml`, `.github/PULL_REQUEST_TEMPLATE.md`
- `ARCHITECTURE.md` (Mermaid + trust boundaries), `docs/threat-to-tests.md` (STRIDE mapping)
- `spec/rfcs/RFC-0005-receipt-callid.md`

### Out of Scope

- README rewrite, ROADMAP.md, ADOPTERS.md, video demo, "Glyph vs MCP" page

## Capabilities

> No existing `openspec/specs/` — all capabilities are new.

### New Capabilities

- `confirmation-backlog-protection`: Hard cap + unconditional sweep + 503 on full backlog (Finding 1)
- `receipt-callid-integrity`: Server-only callId generation, optional clientCallId, RECEIPT_VERSION 0.3 (Finding 2)
- `constant-time-token-auth`: SHA-256 + timingSafeEqual token verification (Finding 3)
- `openapi-ssrf-protection`: Opt-in document server URL, allowedHosts validation, MAJOR semver (Finding 4)
- `request-size-limits`: 1 MiB body cap, 413 on exceed (Finding 5A)
- `schema-complexity-guard`: Max 1000 nodes / 32 depth before AJV compilation (Finding 5B)
- `repo-infrastructure`: CODEOWNERS, dependabot, PR template, ARCHITECTURE.md, threat-to-tests.md

### Modified Capabilities

None — no existing spec files to modify.

## Approach

Test-first for every fix: write failing test → make it pass. One concern per commit. Changeset per package: `@glyphp/server` minor, `@glyphp/types` minor, `@glyphp/core` minor, `@glyphp/adapter-openapi` MAJOR. All fixes parallel-safe — only `errors.ts` shared between Finding 1 and 5A. Reuse existing patterns: sweep+reject from `rateLimitMiddleware`, constructor opts from `GlyphServer`. Never amend prod commits.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/server/src/server.ts` | Modified | MAX_PENDING, unconditional sweep, server-only callId, body size check |
| `packages/server/src/middleware.ts` | Modified | SHA-256 + timingSafeEqual token auth |
| `packages/server/src/errors.ts` | Modified | New codes: CONFIRMATION_BACKLOG_FULL, PAYLOAD_TOO_LARGE |
| `packages/adapters/openapi/src/index.ts` | Modified | allowDocumentServerUrl opt-in, allowedHosts, MAJOR bump |
| `packages/core/src/json-schema-validator.ts` | Modified | Schema node/depth traversal before AJV compile |
| `packages/types/src/types.ts` | Modified | Optional `clientCallId` on `CallReceipt` |
| `spec/rfcs/RFC-0005-receipt-callid.md` | New | Receipt v0.3 semantics + clientCallId |
| `ARCHITECTURE.md`, `docs/threat-to-tests.md` | New | Architecture diagram, STRIDE→test mapping |
| `CODEOWNERS`, `.github/dependabot.yml`, `.github/PULL_REQUEST_TEMPLATE.md` | New | Repo hygiene |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| OpenAPI MAJOR bump breaks consumers | Medium | Document migration; `allowDocumentServerUrl: true` restores old behavior |
| Schema complexity thresholds reject valid schemas | Low | Thresholds overridable; error includes actual vs limit |
| Receipt 0.3 breaks clients parsing callId | Low | `clientCallId` optional; callId-agnostic clients unaffected |

## Rollback Plan

Individual commit reverts per fix. For OpenAPI MAJOR: publish `@glyphp/adapter-openapi@next` with old behavior as one-line revert. For receipt 0.3: keep 0.2 parsing path during transition window.

## Dependencies

None external. All fixes use existing `node:crypto`, `pnpm` workspaces, `changesets`.

## Success Criteria

- [ ] All 5 findings have passing tests (write failing → pass)
- [ ] `pnpm verify:full` green (TS + Go + Python)
- [ ] `pnpm audit --prod` clean
- [ ] `ARCHITECTURE.md` and `docs/threat-to-tests.md` linked from README
- [ ] Changesets ready for PR (one per package)
