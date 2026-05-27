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

## Current state (checkpoint 2026-05-27)

- **Wire protocol 1.0**, **RECEIPT_VERSION 0.3** — all packages live on npm, release workflow healthy.
- **TypeScript 6.0.3** — migrated via controlled spike (#67). Needed `types: ["node"]` in tsconfig.base.json. DTS diff 0 changed.
- **Zod 4.4.3** — migrated via controlled spike (#68). Swapped `zod-to-json-schema` for `@alcyone-labs/zod-to-json-schema` (original generates empty schema silently with Zod 4). `z.record` calls use explicit `z.record(z.string(), z.unknown())`. Schema/card ID stability tests 6/6 pass.
- **Guardrails added:** schema/card ID stability tests (`define.test.ts`), Go baseline CI guard (`scripts/check-go-baseline.mjs`), published declaration consumer smoke (`pnpm type-smoke`).
- **Dependencies:** `hono@4.12.23`, `@types/node@25.9.1`, all GitHub Actions at v6, `pnpm/action-setup@v6`.
- **CI:** Node 20 + 22, Go 1.22, Python 3.11, conformance 8/8, `pnpm verify` green, `pnpm check` exit 0 (warnings only), `pnpm audit --prod` clean.
- **527 TS tests** passing, Go SDK ok, Python SDK 43 passing.
- **Logo:** official asset at `assets/glyphp.png`, displayed in README.
- **Repo:** 1 local branch (`main`), 2 remote (`main` + HEAD). All stale branches/worktrees cleaned. Audit artifacts archived in `openspec/changes/archive/`. `audit-target` workspace renamed to `test-fixtures`.
- **Coverage artifacts purged from git history** (2026-05-27, `git-filter-repo`, `.git` reduced 37→6.2 MB, 280 blobs removed).

## Working style for agents

- **Surgical changes only.** Each edited line must trace to the user's request.
- **Test-first for each P0/P1 fix.** Write the failing test, then make it pass. Pattern reuse from `packages/server/test/middleware.test.ts`, `confirmation.test.ts`, `receipt.test.ts`.
- **Don't bundle unrelated fixes.** PR #20 was closed for this exact reason — one concern per PR.
- **Changeset per concern.** `@glyphp/server` minor, `@glyphp/types` minor, `@glyphp/core` minor, `@glyphp/adapter-openapi` **major** (default change).
- **Never amend prod-release commits.** Always new commits.
- **Don't publish to npm directly.** The release workflow (`changesets/action` + OIDC trusted publishing) handles it after a Version Packages PR merge — and that merge is a user decision, not an agent decision.
- **Major dep upgrades are spikes, not bumps.** For TypeScript, Zod, or any validation/schema-affecting dependency: create an independent branch/worktree, fix minimum necessary, compare `.d.ts` and schema/card IDs against `main`, run `pnpm verify`, then open PR. Never merge Dependabot major PRs directly. For Zod specifically, always runtime-test the JSON Schema converter output — typecheck alone misses silent corruption. See PRs #67 (TS6) and #68 (Zod4) as templates.

## Memory protocol (Engram, Claude Code only)

If using Claude Code: `mem_save` after each fix lands (type: `bugfix`, scope: `project`), `mem_session_summary` before ending. OpenCode and other agents: read this file + the plan file + `~/.claude/projects/-Users-monoperro-IA-Claude-Claude-code-Glyph/memory/project_glyph.md` to bootstrap context.
