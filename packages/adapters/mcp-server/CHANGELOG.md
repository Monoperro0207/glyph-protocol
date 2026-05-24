# @glyphp/adapter-mcp-server

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

### Minor Changes

- 089ec44: New package: `@glyphp/adapter-mcp-server` — expose a Glyph server's tools to
  any MCP client (Claude Desktop, Hermes Agent, Cursor, etc.).

  This is the inverse direction of `@glyphp/adapter-mcp` (which adapts MCP
  tools _into_ Glyph). Together they let Glyph and MCP ecosystems consume
  each other.

  ### What's preserved across the bridge

  - Tool name (with automatic normalization for OpenAI's `^[a-zA-Z0-9_-]+$`
    restriction; `fs.read` → `fs_read`, with a reverse alias for calls)
  - Intent (as MCP description)
  - Risk tier, side-effects, reversibility, confirmation flag — surfaced
    inline in the description so the model can reason about blast radius
  - Input schema (verbatim)
  - Sanitization annotation — when Glyph removed invisible-Unicode content
    from a payload, a brief note is appended to the MCP response so the
    consuming model knows defense ran

  ### What's consumed server-side (not exposed to MCP)

  - Card signatures (verified by `GlyphClient`)
  - Receipt signatures (verified by `GlyphClient`)
  - Attestation envelope
  - The `requiresConfirmation` ticket flow — calls to confirmation-required
    tools are refused at the bridge with a clear error, since the MCP
    transport has no ticket concept and auto-confirming would defeat the
    gate's purpose

  See the package README for the full mapping table.

- c56f710: Add lazy bridge mode: `mcpServerFromGlyphLazy()` / `runStdioBridgeLazy()`.

  The eager bridge (default) surfaces every Glyph card as its own MCP tool,
  so every `tools/list` carries every schema. That is simple and works with
  any MCP client, but the listing scales linearly with catalog size.

  Lazy mode exposes only three meta-tools — `glyph_index`,
  `glyph_describe`, `glyph_invoke` — and lets the model navigate. Cards the
  agent never touches never enter context.

  In a measured comparison (`spec/tests/hermes-comparative-deepseek.md`,
  same prompt, same 49 tools, `deepseek-v4-pro`):

  - Listing tokens: 4,129 → 256 (−93.8%)
  - Total tokens across the task: 168,971 → 77,576 (−54.1%)
  - Estimated cost: $0.0227 → $0.0137 (−40%)

  The trade-off is honest: 2 extra round-trips at the start of a session
  for discovery. For very small catalogs (< ~10 tools) or one-shot tasks,
  eager mode is still preferable. The two modes are exported side-by-side;
  pick the right one for your shape of problem.

### Patch Changes

- Updated dependencies [704a89f]
- Updated dependencies [a703d69]
  - @glyphp/types@1.0.0
  - @glyphp/client@1.0.0
