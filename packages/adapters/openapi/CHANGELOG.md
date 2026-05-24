# @glyphp/adapter-openapi

## 1.0.1

### Patch Changes

- Updated dependencies [94c1b17]
  - @glyphp/types@1.1.0
  - @glyphp/core@1.1.0
  - @glyphp/server@1.1.0

## 1.0.0

### Major Changes

- a703d69: Bump every package to **1.0.0** alongside the **Glyph Protocol 1.0** wire
  release. See [`CHANGELOG-PROTOCOL.md`](../CHANGELOG-PROTOCOL.md) for the
  full wire changeset; the package-level highlights are:

  - **Adapters now validate output by default.** `@glyphp/adapter-mcp` and
    `@glyphp/adapter-openapi` honour the declared `outputSchema` via AJV
    (JSON Schema 2020-12). Pass `outputValidation: 'none'` to opt out.
  - **OpenAPI adapter — header / cookie / security / `servers[]`.** Bearer,
    basic and apiKey (header / query / cookie) security schemes; document
    servers[] fallback; per-style query serialisation; non-JSON response
    passthrough.
  - **`@glyphp/server` returns distinct `CONFIRMATION_REQUIRED` vs
    `INVALID_CONFIRMATION`** for missing-token vs unknown / expired /
    mismatched-token. `depth=bogus` rejects with `400 VALIDATION_FAILED`.
  - **`@glyphp/core` — `KeyRegistry` (RFC-0001).** New
    `FileKeyRegistry` / `HttpKeyRegistry` / `StaticKeyRegistry`, plus
    `buildKeyEntry`, `buildKeyRegistry`, `verifyKeyRegistry`,
    `resolveKey`, `fingerprintKey`. `GlyphServer` exposes `GET /keys`
    when configured with a `keyRegistry`.
  - **`@glyphp/cli` — `glyph keys init|rotate|revoke|list`** and
    `glyph init --profile <local-dev|production-server|consumer-agent>`.
  - **`@glyphp/conformance` — four levels** (`discovery`, `execution`,
    `security`, `governance`) with badge-shaped JSON + Markdown reports
    and standard fixture glyphs (`registerFixtures`).
  - **New framework integration packages** under `@glyphp/integration-*`:
    Vercel AI, LangChain, LlamaIndex, OpenAI Agents.
  - **Schema additions.** New `MALFORMED_JSON`, `INTERNAL_ERROR`,
    `KEY_REVOKED` error codes; new `key-registry.schema.json`.
  - **Cross-language SDKs.** `glyph-protocol` (PyPI) and the Go module
    at `github.com/Monoperro0207/glyph-protocol/sdks/go/glyphprotocol`
    ship at the same 1.0 cycle, sharing canonical test vectors with the
    TypeScript reference.

### Patch Changes

- Updated dependencies [704a89f]
- Updated dependencies [a703d69]
  - @glyphp/types@1.0.0
  - @glyphp/core@1.0.0
  - @glyphp/server@1.0.0

## 0.2.0

### Minor Changes

- 2c64c2d: P1 hardening from the external audit.

  `@glyphp/server` — a glyph handler now receives a `GlyphHandlerContext` with an
  `AbortSignal` that fires when the call exceeds its timeout, so a cooperating
  handler can stop doing real work instead of running on in the background after
  the `504`.

  `@glyphp/adapter-openapi` / `@glyphp/adapter-mcp` — the JSON Schema → Zod
  conversion is now recursive: enums, typed arrays, nested objects and common
  string formats are enforced, instead of only a value's top-level type.

  `@glyphp/cli` — `glyph init` scaffolds `@glyphp/server` at `latest` rather than
  a pinned version that goes stale.

### Patch Changes

- Updated dependencies [9236a66]
- Updated dependencies [6d6ec5a]
- Updated dependencies [2c64c2d]
- Updated dependencies [fcf5721]
  - @glyphp/types@0.2.0
  - @glyphp/core@0.2.0
  - @glyphp/server@0.2.0
