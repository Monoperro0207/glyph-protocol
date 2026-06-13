# @glyphp/cli

## 1.3.3

### Patch Changes

- Updated dependencies [4418e47]
  - @glyphp/core@1.6.0
  - @glyphp/adapter-mcp@1.1.2
  - @glyphp/client@1.3.2

## 1.3.2

### Patch Changes

- Updated dependencies [25173f4]
- Updated dependencies [755ebf6]
  - @glyphp/core@1.5.0
  - @glyphp/adapter-mcp@1.1.1
  - @glyphp/client@1.3.1

## 1.3.1

### Patch Changes

- Updated dependencies [c51a47c]
- Updated dependencies [fbf08d2]
  - @glyphp/client@1.3.0
  - @glyphp/adapter-mcp@1.1.0

## 1.3.0

### Minor Changes

- 2fa9732: Add `FilePendingAuditQueue` (a persistent `PendingAuditQueue` that mirrors
  `FilePinStore`) and the `glyph audit list` CLI command. The command reads the
  persisted queue (default `~/.glyph/pending-audits.json`, override with `--file`)
  and renders each parked tool update with its diff and a breaking/review verdict,
  read-only. It exits non-zero when any parked update carries a breaking change
  awaiting review, so it can gate CI. Promotion stays a separate step
  (`glyph approve` or the autonomous runner).
- c552787: Add interactive write actions to the `glyphp` shell: **Approve** (pin a card
  from a file or URL) and **Revoke** (block a previously approved tool). Both run
  through a three-step `ActionFlow` — type the argument, then an explicit
  confirmation gate (`y`/`n`) that must be accepted before anything executes;
  typing or `esc` never triggers the action. Adds `ink-text-input`.
- ef85149: Polish the `glyphp` interactive shell: add `glyphp --help` (and `-h`) with
  plain, scriptable usage text, and a non-TTY fallback — when stdout is not a
  terminal (piped, redirected, CI) `glyphp` prints a short message pointing at
  the one-shot `glyph <command>` CLI instead of hanging on an interactive
  render. Both paths emit color-free text and respect `NO_COLOR`.
- 691cb3c: Add the `glyphp` interactive terminal — a new binary that boots an Ink-based
  shell with an animated glyph cursor. `glyphp` (no args) opens a navigable menu
  (↑/↓ or j/k, Enter, esc/q) with read-only panels for pins and the local key
  registry, plus a help view. The one-shot `glyph <command>` binary is unchanged
  and remains the path for scripting and CI. Adds `ink` + `react`. Write actions
  (approve/revoke/keys) and the non-TTY fallback land in follow-up PRs.

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
  - @glyphp/adapter-mcp@1.0.5

## 1.2.3

### Patch Changes

- Updated dependencies [6062ac1]
- Updated dependencies [3900f5b]
  - @glyphp/types@1.4.0
  - @glyphp/core@1.3.1
  - @glyphp/client@1.1.1
  - @glyphp/adapter-mcp@1.0.4

## 1.2.2

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
  - @glyphp/adapter-mcp@1.0.3

## 1.2.1

### Patch Changes

- Updated dependencies [44caa8c]
- Updated dependencies [1df7009]
- Updated dependencies [44caa8c]
  - @glyphp/core@1.2.0
  - @glyphp/types@1.2.0
  - @glyphp/adapter-mcp@1.0.2
  - @glyphp/client@1.0.2

## 1.2.0

### Minor Changes

- 8d20c6d: Add `glyph import mcp`: a new top-level command that auto-maps MCP servers
  from an existing client config (Claude Desktop, Cursor, Codex) or a manual
  `--command`/`--url` target into Glyph bridges. Each imported MCP becomes a
  self-contained `server.ts` + `package.json` + `.env.example` + `README.md`
  under `glyph-imports/<name>/`. A markdown `IMPORT_REPORT.md` summarises
  what was imported, what was skipped (with reasons), and which cards the
  adapter heuristic tagged as `danger` or `caution` for review.

  Failure policy: a single MCP that fails to connect (missing env var,
  command not found, timeout) is skipped with a warning, never aborting the
  rest of the run. Interactive mode prompts the user to select which client
  to read from and which servers within that client to bridge.

  `--from openclaw` and `--from hermes-agent` are present in the surface but
  deliberately throw `not implemented yet` — see `spec/rfcs/RFC-0004-import-clients.md`
  for why we chose loud-failure over a fragile parser.

  Pulls in `@modelcontextprotocol/sdk`, `@iarna/toml`, and `@glyphp/adapter-mcp`
  as direct dependencies of the CLI.

## 1.1.0

### Minor Changes

- 94c1b17: `glyph init` now supports 5 profiles (plus `local-dev`), and prompts
  interactively when run on a TTY without `--profile`:

  - `production-server` (recommended, default) — stable key, auth, rate
    limit, pin store.
  - `agent-ts` — TypeScript consumer with `FilePinStore` and `renderEnvelope`.
  - `mcp-bridge` — Glyph server that re-exports an MCP server via
    `@glyphp/adapter-mcp`.
  - `openapi-wrapper` — Glyph server that re-exports an OpenAPI 3.x spec via
    `@glyphp/adapter-openapi`.
  - `python-client` — Python script using `glyph-protocol` on PyPI.
  - `local-dev` — ephemeral key, no auth (prototyping only).

  `--profile consumer-agent` continues to work as an alias for `agent-ts`.

### Patch Changes

- Updated dependencies [94c1b17]
  - @glyphp/types@1.1.0
  - @glyphp/core@1.1.0
  - @glyphp/client@1.0.1

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
  - @glyphp/client@1.0.0

## 0.3.0

### Minor Changes

- 6cba6c8: Production-grade defaults for consumer-side update governance.

  - `FilePinStore` — a persistent `PinStore` that writes pins atomically to a
    JSON file. Survives restarts. Recommended for any deployed agent.
  - `secureMode: true` on `GlyphClient` refuses to construct without a
    `PinStore` configured, so a tool that has not been deliberately approved
    can never run.
  - New CLI commands: `glyph pins list`, `glyph approve <card>`,
    `glyph revoke <tool>`, `glyph manifest verify <src>`. Pins live at
    `~/.glyph/pins.json` by default; `--file <path>` keeps a project-local
    store.

  All additions are opt-in — existing callers that do not pass `secureMode`
  or use the new CLI commands behave exactly as before.

### Patch Changes

- Updated dependencies [6cba6c8]
  - @glyphp/client@0.3.0

## 0.2.0

### Minor Changes

- fcf5721: Tool update governance.

  A verified card is content-addressed, so a real change to a tool changes its
  id — but the protocol did not yet _govern_ what a consumer does when an
  approved tool changes underneath it. This adds that layer. It is entirely
  additive: no wire-breaking change, `PROTOCOL_VERSION` stays `0.2`.

  `@glyphp/client` — `GlyphClient` accepts a `PinStore`. It verifies every card
  signature, pins an approved `(id, publicKey)` pair per tool, and refuses in
  `call()` any tool that is new, changed, or revoked. New surface: `inspectCard`,
  `approveCard`, `revokeTool`, `inspectLexicon`, `getManifest`, `MemoryPinStore`,
  and the `GlyphVerificationError` / `GlyphNotApprovedError` / `GlyphRevokedError`
  error types.

  `@glyphp/core` — `diffCards()` classifies how two cards differ (breaking vs
  review changes); `signManifest()` / `verifyManifest()` sign and verify update
  manifests.

  `@glyphp/server` — `registerManifest()` publishes a signed `UpdateManifest`,
  served from the new optional `GET /glyphs/:name/manifest` endpoint.

  `@glyphp/cli` — `glyph diff-card <old> <new>` classifies how two cards differ
  and exits non-zero on a breaking change.

  `@glyphp/types` — new `Pin`, `CardDiff`, `CardFieldChange` and `UpdateManifest`
  types, and the `MANIFEST_VERSION` constant.

  The lifecycle, pinning model and update manifest are specified in
  `spec/update-governance.md`.

### Patch Changes

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

- Updated dependencies [9236a66]
- Updated dependencies [6d6ec5a]
- Updated dependencies [fcf5721]
  - @glyphp/types@0.2.0
  - @glyphp/core@0.2.0
  - @glyphp/client@0.2.0
