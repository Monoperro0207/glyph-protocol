# @glyphp/integration-vercel-ai

## 1.1.7

### Patch Changes

- Updated dependencies [25173f4]
- Updated dependencies [755ebf6]
  - @glyphp/core@1.5.0
  - @glyphp/client@1.3.1

## 1.1.6

### Patch Changes

- Updated dependencies [c51a47c]
  - @glyphp/client@1.3.0

## 1.1.5

### Patch Changes

- Updated dependencies [2fa9732]
- Updated dependencies [ad538e4]
- Updated dependencies [7945823]
- Updated dependencies [0e8846b]
- Updated dependencies [34dcfd4]
- Updated dependencies [6dc6c84]
- Updated dependencies [2fb8e2b]
  - @glyphp/client@1.2.0
  - @glyphp/core@1.4.0
  - @glyphp/types@1.5.0

## 1.1.4

### Patch Changes

- Updated dependencies [6062ac1]
- Updated dependencies [3900f5b]
  - @glyphp/types@1.4.0
  - @glyphp/core@1.3.1
  - @glyphp/client@1.1.1

## 1.1.3

### Patch Changes

- Updated dependencies [60f21e0]
- Updated dependencies [f34252f]
- Updated dependencies [d868938]
- Updated dependencies [85584c8]
- Updated dependencies [85584c8]
- Updated dependencies [a8f5656]
  - @glyphp/client@1.1.0
  - @glyphp/core@1.3.0
  - @glyphp/types@1.3.0

## 1.1.2

### Patch Changes

- Updated dependencies [44caa8c]
- Updated dependencies [1df7009]
- Updated dependencies [44caa8c]
  - @glyphp/core@1.2.0
  - @glyphp/types@1.2.0
  - @glyphp/client@1.0.2

## 1.1.1

### Patch Changes

- Updated dependencies [94c1b17]
  - @glyphp/types@1.1.0
  - @glyphp/core@1.1.0
  - @glyphp/client@1.0.1

## 1.1.0

### Minor Changes

- f950a32: **Safety fix + DX improvement.** Stays on the 1.x line because the
  behavioural change is strictly safer (a hook that used to authorize
  incorrectly now rejects) and a misbehaving hook would not crash — it
  just falls back to refusing the confirmed call, matching the
  documented intent.

  Two changes to all four framework integrations
  (Vercel AI, LangChain, LlamaIndex, OpenAI Agents):

  1. **Real input schemas.** `glyphsAs*Tools(client)` now fetches each glyph's
     `rich` card and uses `card.input` as the tool's parameter schema, so the
     LLM gets the real JSON Schema instead of `{}`. The synchronous helper
     `fromLexicon(...)` still emits empty schemas (low-fidelity, opt-in).

  2. **`onConfirmation` is now strictly boolean.** The hook signature was
     `Promise<string | undefined>` and treated any truthy value as approval —
     so a hook that returned the string `"reject"` accidentally authorized
     the call. The hook is now `Promise<boolean>`; only the literal `true`
     authorizes. Any other value (including `false`, `undefined`, non-boolean,
     or a thrown error) re-raises the original `CONFIRMATION_REQUIRED`. The
     hook also now receives the bound `confirmationToken` so it can be
     forwarded to a human approver out-of-band.

  Migration: change `onConfirmation` implementations from
  `return "approved"` / `return undefined` to `return true` / `return false`.

## 2.0.0

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
  - @glyphp/client@1.0.0
