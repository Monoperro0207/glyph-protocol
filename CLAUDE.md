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

## Current state (checkpoint 2026-05-25)

- **Wire protocol 0.3** — RECEIPT_VERSION bumped, 5 audit findings resolved, all packages live on npm.
- **Security**: confirmation backlog hard-cap (10K + 503), server-generated callId, SHA-256 + timingSafeEqual token comparison.
- **Hardening**: 1 MiB body limit + stream fallback, schema complexity guard (1000 nodes / 32 depth), OpenAPI baseUrl trust model (MAJOR bump for `@glyphp/adapter-openapi`).
- **Repo**: `CODEOWNERS`, `dependabot.yml`, `PULL_REQUEST_TEMPLATE.md`, `ARCHITECTURE.md` (Mermaid + trust boundaries), `docs/threat-to-tests.md` (STRIDE mapping), `RFC-0005`.
- **Tooling**: Biome linter + formatter, `c8` coverage (`pnpm coverage` → 83%), Python SDK venv fix.
- 306 TS tests passing, Go SDK ok, Python SDK 41 passing, `pnpm audit --prod` clean, conformance 8/8.
- Local branches alive but untouched: `feat/hermes-deepseek-test`, `fix/audit-h1-h2-symlink-jail`.
- PRs #23, #24, #25 merged via `fix/audit-fixes` tracker → `main`.

## Working style for agents

- **Surgical changes only.** Each edited line must trace to the user's request.
- **Test-first for each P0/P1 fix.** Write the failing test, then make it pass. Pattern reuse from `packages/server/test/middleware.test.ts`, `confirmation.test.ts`, `receipt.test.ts`.
- **Don't bundle unrelated fixes.** PR #20 was closed for this exact reason — one concern per PR.
- **Changeset per concern.** `@glyphp/server` minor, `@glyphp/types` minor, `@glyphp/core` minor, `@glyphp/adapter-openapi` **major** (default change).
- **Never amend prod-release commits.** Always new commits.
- **Don't publish to npm directly.** The release workflow (`changesets/action` + OIDC trusted publishing) handles it after a Version Packages PR merge — and that merge is a user decision, not an agent decision.

## Memory protocol (Engram, Claude Code only)

If using Claude Code: `mem_save` after each fix lands (type: `bugfix`, scope: `project`), `mem_session_summary` before ending. OpenCode and other agents: read this file + the plan file + `~/.claude/projects/-Users-monoperro-IA-Claude-Claude-code-Glyph/memory/project_glyph.md` to bootstrap context.
