# Branch cleanup report — 2026-05-26

No branches were deleted. This report groups local/remote branches by cleanup risk based on `git branch` and `gh pr list --state all --limit 100`.

## Merged/local candidates for later deletion

These local branches are merged into `main` according to `git branch --merged main`:

- `chore/hono-node-server-v2` — PR #35 merged.
- `feat/audit-p2-attestation-core` — PR #45 merged, but prior exploration saw local divergence; inspect before deleting.
- `feat/hermes-deepseek-test` — PR #10 merged; CLAUDE.md previously called it WIP, so confirm with owner first.
- `fix/audit-h1-h2-symlink-jail` — PR #11 merged.

## Local branches not merged into main

Do not delete without owner review:

- `changeset-release/main` — release-managed branch; closed/merged Version Packages PRs exist.
- `chore/noble-ed25519-v3` — PR #34 closed; main already uses `@noble/ed25519` v3.1.0, but inspect before deleting.
- `dependabot/npm_and_yarn/hono/node-server-2.0.4` — PR #29 closed/replaced.
- `feat/audit-p2-attestation-client` — PR #46 merged remotely but local branch not reported merged; inspect divergence.
- `feat/audit-p2-production-hardening` — PR #44 merged remotely but local branch not reported merged; inspect divergence.
- `feat/audit-p2-trust-registry` — PR #47 merged remotely but local branch not reported merged; inspect divergence.
- `feat/audit-p3-conformance-profiles` — PR #50 merged remotely but local branch not reported merged; inspect divergence.
- `feat/audit-p3-coverage-boost` — PR #49 merged remotely but local branch not reported merged; inspect divergence.
- `feat/audit-p3-release-attestation` — PR #51 merged remotely but local branch not reported merged; inspect divergence.
- `feat/audit-p3-threat-models` — PR #48 merged remotely but local branch not reported merged; inspect divergence.
- `fix/audit-fixes` — tracker branch from audit-fixes work.
- `fix/audit-fixes-pr1` — PR #23 merged, but local branch not reported merged; inspect divergence.
- `fix/audit-fixes-pr2` — PR #24 closed.
- `fix/audit-fixes-pr3` — PR #25 closed.
- `fix/audit-p0-client-strict` — PR #42 merged remotely but local branch not reported merged; inspect divergence.
- `fix/audit-p0-doc-and-validator` — PR #40 merged remotely but local branch not reported merged; inspect divergence.
- `fix/audit-p0-openapi-redact` — PR #41 merged remotely but local branch not reported merged; inspect divergence.
- `fix/coverage-boost` — PR #53 merged remotely but local branch not reported merged; inspect divergence.

## Remote stale candidates

Remote branches with merged or closed PRs can be reviewed for deletion in GitHub after owner approval. Notable candidates:

- `origin/fix/audit-h1-h2-symlink-jail` — PR #11 merged.
- `origin/fix/audit-fixes-pr1` — PR #23 merged.
- `origin/fix/audit-fixes-pr2` — PR #24 closed.
- `origin/fix/audit-fixes-pr3` — PR #25 closed.
- `origin/chore/noble-ed25519-v3` — PR #34 closed, migration appears landed elsewhere.
- `origin/dependabot/npm_and_yarn/hono/node-server-2.0.4` — PR #29 closed/replaced.

## Avoid touching without release context

- `changeset-release/main`
- `origin/changeset-release/main`

## Recommended next step

Before deleting any branch, inspect exact divergence with:

```bash
git log --oneline main..BRANCH
git log --oneline BRANCH..main
```

Then delete only branches whose unique commits are already represented in merged PRs or intentionally abandoned.
