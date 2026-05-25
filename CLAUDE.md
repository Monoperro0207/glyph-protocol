# CLAUDE.md — Glyph Protocol

Project-level guidance for any coding agent (Claude Code, OpenCode, Cursor, etc.) working in this repo. Last updated 2026-05-24.

## What this repo is

Glyph Protocol — signed, content-addressed tool contracts for AI agents. Monorepo (pnpm workspaces, 10 packages under `@glyphp/*`), full spec in `spec/`, conformance suite, SDKs in TS/Go/Python, ed25519 signing, sealed envelopes with inspection reports, server-side confirmation gate, public npm.

Public repo: https://github.com/Monoperro0207/glyph-protocol — owner only, light branch protection on `main`.

## Run / verify

```bash
pnpm install --frozen-lockfile
pnpm verify          # typecheck + tests + build + conformance
pnpm verify:full     # also runs Go + Python SDK tests
pnpm audit --prod    # CVE check
```

Dev runs from `src/` via tsx (do NOT `node dist/...` inside the workspace — workspace deps point at sibling `src/*.ts` in dev; `publishConfig` rewrites to `dist/` only in published tarballs). Use `pnpm --filter <pkg> exec tsx src/cli.ts ...` when smoke-testing the CLI locally.

## Current state (checkpoint 2026-05-24)

- **Wire protocol 0.2** published, all 10 packages live on npm.
- **`@glyphp/cli@1.2.0`** published with `glyph import mcp` — auto-maps MCPs from Claude Desktop / Cursor / Codex configs (or `--command`/`--url`). PR #21 merged, Version Packages PR #18 merged by user.
- PR #20 (doc/rate-limit bundle) closed as bundled-anti-pattern; rate-limit bug preserved as **issue #22** with repro + fix proposal.
- External CEO/Producto/Security audit received → score **8.4/10** with 5 actionable findings (see "Next steps" below).
- 282 TS tests passing, Go SDK ok, Python SDK 41 passing, `pnpm audit --prod` clean, conformance 8/8.
- Local branches alive but untouched: `feat/hermes-deepseek-test`, `fix/audit-h1-h2-symlink-jail`.

## Next steps — audit fixes (NOT yet implemented)

Full plan at `~/.claude/plans/planifica-breezy-mango.md`. Five concrete fixes, each with file:line:

### P0 — block public promotion until done
1. **Unbounded `pendingConfirmations`** — `packages/server/src/server.ts:362-375`. Sweep is conditional on `size > 1000`, no hard ceiling. Add `MAX_PENDING_CONFIRMATIONS = 10_000` (overridable via constructor opts at `server.ts:86-100`), make sweep unconditional, return `503 CONFIRMATION_BACKLOG_FULL` + `Retry-After` when full. Test: 10_001 tickets → 503.
2. **Client-controlled `callId`** — `server.ts:393-398` and signing site `server.ts:519-523`. Change `body.callId ?? randomUUID()` to always `randomUUID()`. Preserve incoming as new optional `clientCallId` field on `CallReceipt` (`packages/types/src/receipt.ts`). **Bump `RECEIPT_VERSION` 0.2 → 0.3**, new RFC `spec/rfcs/RFC-0005-receipt-callid.md`, document in `CHANGELOG-PROTOCOL.md`.
3. **Token comparison constant-time** — `packages/server/src/middleware.ts:20-24`. Replace `(config.tokens ?? []).includes(token)` with SHA-256 hash both sides + `crypto.timingSafeEqual`.

### P1 — operational hardening
4. **OpenAPI baseUrl trust** — `packages/adapters/openapi/src/index.ts:51-57`. Add `allowDocumentServerUrl: boolean` (default `false`) + optional `allowedHosts: string[]`. Throw if neither `options.baseUrl` nor opt-in is set. This is a **major bump** for `@glyphp/adapter-openapi`.
5. **Body size + schema complexity limits** — `readJson()` at `server.ts:46-52` and `packages/core/src/json-schema-validator.ts:44-48`. Check `Content-Length` → `413 PAYLOAD_TOO_LARGE` over 1 MiB. Schema wrapper rejects > 1000 nodes or > 32 depth → `SCHEMA_TOO_COMPLEX`.

### P1 — repo hygiene
- New: `CODEOWNERS`, `.github/dependabot.yml`, `.github/PULL_REQUEST_TEMPLATE.md`, `ARCHITECTURE.md` (Mermaid diagram + trust boundaries), `docs/threat-to-tests.md` (STRIDE → test mapping). Reuse content from `spec/protocol.md`, `spec/trust.md`, `spec/security.md`, `packages/conformance/`.

### Out of scope for this round
README first-screen rewrite, `ROADMAP.md`, `ADOPTERS.md`, video demo, "Glyph vs MCP" page. Defer until after dogfooding.

## Working style for agents

- **Surgical changes only.** Each edited line must trace to the user's request or to one of the 5 findings above.
- **Test-first for each P0/P1 fix.** Write the failing test, then make it pass. Pattern reuse from `packages/server/test/middleware.test.ts`, `confirmation.test.ts`, `receipt.test.ts`.
- **Don't bundle unrelated fixes.** PR #20 was closed for this exact reason — one concern per PR.
- **Changeset per concern.** `@glyphp/server` minor, `@glyphp/types` minor, `@glyphp/core` minor, `@glyphp/adapter-openapi` **major** (default change).
- **Never amend prod-release commits.** Always new commits.
- **Don't publish to npm directly.** The release workflow (`changesets/action` + OIDC trusted publishing) handles it after a Version Packages PR merge — and that merge is a user decision, not an agent decision.

## Memory protocol (Engram, Claude Code only)

If using Claude Code: `mem_save` after each fix lands (type: `bugfix`, scope: `project`), `mem_session_summary` before ending. OpenCode and other agents: read this file + the plan file + `~/.claude/projects/-Users-monoperro-IA-Claude-Claude-code-Glyph/memory/project_glyph.md` to bootstrap context.
