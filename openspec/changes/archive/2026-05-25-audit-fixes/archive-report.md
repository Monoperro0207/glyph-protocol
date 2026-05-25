# Archive Report: audit-fixes

**Archived**: 2026-05-25
**Verdict**: PASS — 0 CRITICAL, 0 WARNING
**Mode**: openspec

## Executive Summary

Hardened the Glyph Protocol from 8.4/10 to ≥9.0 by fixing 5 security/correctness findings from an external audit, plus repo hygiene improvements. All fixes were test-first, independently testable, and revertible. Three chained PRs delivered all work across 14 conventional commits.

## What Was Accomplished

### P0 — Security Blockers (PR #23)
- **Finding 1 — Confirmation backlog cap**: Added `MAX_PENDING_CONFIRMATIONS = 10_000` (overridable), unconditional sweep, and `503 CONFIRMATION_BACKLOG_FULL` with `Retry-After` header
- **Finding 2 — Server-generated callId**: Server always generates `callId` via `randomUUID()`; client-supplied value preserved as optional `clientCallId`; `RECEIPT_VERSION` bumped `0.2` → `0.3`; documented in `RFC-0005-receipt-callid.md`
- **Finding 3 — Constant-time token auth**: Replaced `Array.includes()` with SHA-256 hash + `crypto.timingSafeEqual` for token comparison

### P1 — Operational Hardening (PR #24)
- **Finding 5A — Body size limit**: 1 MiB cap (`MAX_BODY_BYTES`) via `Content-Length` check → `413 PAYLOAD_TOO_LARGE`, overridable via `options.maxBodyBytes`
- **Finding 5B — Schema complexity guard**: Recursive pre-AJV walk rejecting schemas with >1000 nodes or >32 depth → `SCHEMA_TOO_COMPLEX`
- **Finding 4 — OpenAPI SSRF protection**: `allowDocumentServerUrl` default `false`, explicit `baseUrl` required, optional `allowedHosts` filter. **MAJOR bump** for `@glyphp/adapter-openapi`

### Repo Hygiene (PR #25)
- `CODEOWNERS` (`* @Monoperro0207`)
- `.github/dependabot.yml` (npm, weekly Monday, grouped)
- `.github/PULL_REQUEST_TEMPLATE.md` (verify, RFC, schema checklist)
- `ARCHITECTURE.md` (Mermaid trust boundaries + component map)
- `docs/threat-to-tests.md` (STRIDE → test mapping)

### Test Results
| Suite | Result |
|-------|--------|
| TypeScript (unit) | **305/305 passing** (23 new + 282 existing) |
| Go SDK | ✅ Passing |
| Python SDK | **41/41 passing** |
| Build (22 packages) | ✅ Clean |
| `pnpm audit --prod` | ✅ No vulnerabilities |
| Conformance (4/4 levels) | ✅ Compatible |

### Spec Compliance
**25/25 scenarios compliant** across all 7 specs. Zero failures, zero untested, zero partial. All 8 design decisions verified in implementation. All 13 tasks complete.

### Breaking Changes (Documented)
| Change | Version | Migration |
|--------|---------|-----------|
| `@glyphp/adapter-openapi` MAJOR | Old: implicit `servers[0].url` → New: explicit `baseUrl` or `allowDocumentServerUrl: true` | Changeset with before/after code |
| `RECEIPT_VERSION` 0.2 → 0.3 | `callId` now server-owned; client correlation via `clientCallId` | RFC-0005 §Migration |

### PR Chain
| PR | Scope | Branch | Status |
|----|-------|--------|--------|
| #23 | P0 fixes (errors + backlog + callId + CT token) | `fix/audit-fixes-pr1` | Created |
| #24 | P1 hardening (body limit + schema guard + OpenAPI SSRF) | `fix/audit-fixes-pr2` | Created |
| #25 | Docs + RFC + hygiene + changesets | `fix/audit-fixes-pr3` | Created |

Chain integrity verified: PR1 base = `fix/audit-fixes`, PR2 base = `fix/audit-fixes-pr1`, PR3 base = `fix/audit-fixes-pr2`. All 14 commits follow conventional format.

### Remaining Work (SUGGESTION items from verify)
| Item | Priority | Status |
|------|----------|--------|
| Stream fallback for absent `Content-Length` | SUGGESTION | Deferred — not a spec requirement |
| Coverage tool (c8/vitest) | SUGGESTION | Deferred — repo infrastructure |
| Linter setup | SUGGESTION | Deferred — repo infrastructure |
| Python SDK capability caching | SUGGESTION | Already corrected in commit `27c8370` |

### Archive Contents
- ✅ `explore.md` — 5 verified findings with code-level confirmation
- ✅ `proposal.md` — Intent, scope, capabilities, risks, rollback plan
- ✅ `specs/` — 7 domain specs (25 scenarios total)
- ✅ `design.md` — 5 architecture decisions, data flow diagram, test strategy
- ✅ `tasks.md` — 13/13 tasks complete (5 phases)
- ✅ `verify-report.md` — Full TDD compliance (6/6), PASS verdict
- ✅ `archive-report.md` — This file

### Source of Truth Updated
All 7 specs now live at `openspec/specs/{domain}/spec.md`:
- `confirmation-backlog-limit`
- `server-generated-callid`
- `constant-time-token-check`
- `openapi-trusted-baseurl`
- `body-and-schema-limits`
- `repo-hygiene`
- `rfc-0005-receipt-callid`

### SDD Cycle Complete
The audit-fixes change has been fully explored, specified, designed, implemented (test-first), verified, and archived. The Glyph Protocol is hardened to ≥9.0 signal. Ready for the next change.
