# @glyphp/adapter-openapi

## 3.1.3

### Patch Changes

- Updated dependencies [346973e]
  - @glyphp/core@2.0.0
  - @glyphp/server@1.4.2

## 3.1.2

### Patch Changes

- Updated dependencies [4418e47]
  - @glyphp/core@1.6.0
  - @glyphp/server@1.4.1

## 3.1.1

### Patch Changes

- Updated dependencies [25173f4]
- Updated dependencies [0d3149a]
- Updated dependencies [755ebf6]
- Updated dependencies [f702300]
  - @glyphp/core@1.5.0
  - @glyphp/server@1.4.0

## 3.1.0

### Minor Changes

- dfba4e5: Support the `x-glyph-risk` vendor extension on OpenAPI operations. The API
  author can override the HTTP-method risk heuristic (`safe` | `caution` |
  `danger`) when it is wrong — e.g. a genuinely safe POST search, or a GET that
  triggers an expensive, irreversible job. The override sets the risk tier (and
  `requiresConfirmation` follows it); `sideEffects`/`reversible` stay factual to
  the method, so the override never misreports whether the call mutates state. An
  unrecognised value is rejected (fail-closed). Operations without the extension
  behave exactly as before.

## 3.0.2

### Patch Changes

- Updated dependencies [0e8846b]
- Updated dependencies [34dcfd4]
  - @glyphp/core@1.4.0
  - @glyphp/types@1.5.0
  - @glyphp/server@1.3.2

## 3.0.1

### Patch Changes

- Updated dependencies [6062ac1]
- Updated dependencies [3900f5b]
  - @glyphp/types@1.4.0
  - @glyphp/core@1.3.1
  - @glyphp/server@1.3.1

## 3.0.0

### Major Changes

- 7713204: Redact API keys, tokens, and other secrets from HTTP error messages to prevent credential leaks in logs and error displays. The `redactUrl()` helper replaces sensitive query parameter values (api_key, token, secret, password, etc.) with `***` before they appear in thrown Error messages.

### Patch Changes

- Updated dependencies [f34252f]
- Updated dependencies [8ec3e34]
- Updated dependencies [d868938]
- Updated dependencies [85584c8]
  - @glyphp/core@1.3.0
  - @glyphp/server@1.3.0
  - @glyphp/types@1.3.0

## 2.0.0

### Major Changes

- 44caa8c: **Breaking change: explicit baseUrl trust required.** The adapter no longer uses `doc.servers[0].url` from the OpenAPI document by default — this was a SSRF vector when consuming untrusted specs. Two new options replace the implicit behaviour:

  - `allowDocumentServerUrl?: boolean` (default `false`) — opt in to the previous implicit-behaviour when you trust the spec.
  - `allowedHosts?: string[]` — an optional host allowlist to validate the resolved baseUrl against.

  **Migration:**

  ```ts
  // Before — implicitly trusted doc.servers[0].url
  new OpenApiAdapter({ document: spec });

  // After — must opt in OR provide explicit baseUrl
  new OpenApiAdapter({ document: spec, allowDocumentServerUrl: true });
  // or
  new OpenApiAdapter({ document: spec, baseUrl: "https://api.example.com" });
  ```

  Without either option, the adapter throws:

  > `OpenAPI: refusing to use spec-declared servers[0].url without explicit allowDocumentServerUrl: true or options.baseUrl. SSRF risk if the spec is untrusted.`

### Patch Changes

- Updated dependencies [44caa8c]
- Updated dependencies [1df7009]
- Updated dependencies [44caa8c]
- Updated dependencies [44caa8c]
  - @glyphp/core@1.2.0
  - @glyphp/server@1.2.0
  - @glyphp/types@1.2.0

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
