# Contributing to Glyph Protocol

Thanks for the interest. Glyph aims to be a small, sharp protocol — the
contribution bar reflects that: every change should make the protocol
clearer, faster to adopt, or safer.

## Setup

```bash
corepack enable
pnpm install
pnpm verify         # typecheck + test + build + smoke + conformance
pnpm verify:full    # also runs the Python and Go SDK suites if installed
```

If you do not have Python 3.10+ or Go 1.22+ installed, `verify:full`
skips those steps and **names them in the final summary**, so a partial run is
never reported as full coverage. A toolchain that *is* installed but whose
tests fail is a real failure — `verify:full` exits non-zero, never a warning.

## Where things live

```
packages/                    # TypeScript SDK
  types/                     # wire types (zero-runtime)
  core/                      # canonicalize, hash, sign, verify, sanitize, key registry
  server/                    # GlyphServer + middleware
  client/                    # GlyphClient + pin store + render
  conformance/               # executable conformance suite (4 levels)
  cli/                       # `glyph` command
  resolver/                  # intent → glyph resolver
  adapters/                  # mcp + openapi adapters
  integrations/              # vercel-ai, langchain, llamaindex, openai-agents

spec/                        # normative protocol
  protocol.md
  trust.md
  security.md
  update-governance.md
  rfcs/                      # protocol RFCs (RFC-0001 = key registry)
  schemas/                   # JSON Schema 2020-12 for every wire message
  canonical/                 # cross-SDK test vectors

sdks/                        # non-TypeScript SDKs
  python/                    # verify + client
  go/glyphprotocol/          # verify + client
```

## Patches that don't need an RFC

- Bug fixes,
- Documentation,
- Test additions and conformance hardening,
- New examples,
- Performance work,
- Package-internal refactors that preserve the public API.

Open a PR, link the issue (if any), and make sure `pnpm verify` passes.

## Required CI checks

PRs to `main` must show these jobs green before merging:

- `verify (20)` and `verify (22)` — Node typecheck + test + build + smoke + conformance.
- `python-sdk` — `pytest` against the Python SDK.
- `go-sdk` — `go test ./...` against the Go SDK.

Together these reproduce `pnpm verify:full` across all three toolchains.
Maintainers configure branch protection in the repository settings to
enforce them.

## Patches that need an RFC

See [`GOVERNANCE.md` — RFC process](GOVERNANCE.md#rfc-process).
Anything that touches the **wire** (new endpoints, error codes, schema
fields, hashing or signature rules, key/identity model, conformance
level semantics) needs an RFC under `spec/rfcs/`.

## Coding conventions

- TypeScript strict mode. No `any` in public APIs.
- Comments explain *why*, not *what*. The code already says what.
- Tests live next to the package (`packages/<name>/test/`). Use
  `node:test` + `assert/strict`.
- Wire format changes must include matching JSON Schema and canonical
  test-vector updates (regenerate via `pnpm exec node scripts/generate-vectors.mjs`).
- Cross-SDK changes must keep `spec/canonical/` byte-identical across
  TypeScript, Python and Go.

## License

By contributing you agree your contributions are licensed under the
Apache License 2.0 (the project license).
