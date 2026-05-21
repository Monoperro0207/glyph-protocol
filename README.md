# Glyph Protocol SDK

> A connection protocol designed from the ground up for LLM consumers.

Each tool publishes a **glyph** — a self-describing, signed, content-addressed card that carries not just the schema but also intent, cost, risk, and reversibility.

## Packages

| Package | Description |
|---|---|
| `@glyph/types` | Pure TypeScript interfaces |
| `@glyph/core` | Hash, sign, validate |
| `@glyph/server` | GlyphServer (Hono) |
| `@glyph/client` | GlyphClient |
| `@glyph/resolver` | Intent → glyph resolver (pluggable scorers) |
| `@glyph/adapter-openapi` | Convert an OpenAPI document into glyphs |

## Quick Start

```bash
pnpm install
cd examples/01-hello-glyph
pnpm server   # terminal 1
pnpm client   # terminal 2
```

## Verify

```bash
pnpm typecheck   # type-check every package and the example
pnpm test        # run the @glyph/core and @glyph/server test suites
```

## Status

- **Phase 1 — complete.** Four packages + the `01-hello-glyph` example, typechecked and tested.
- **Phase 2 — in progress.**
  - ed25519 signing: glyph cards carry an embedded public key and an ed25519
    signature over the card id; `verifyGlyph` checks both content integrity
    and provenance.
  - `@glyph/resolver`: natural-language intent → candidate glyphs, with a
    zero-dependency lexical scorer by default and an opt-in embedding scorer.
  - `@glyph/adapter-openapi`: turn any OpenAPI 3.x document into registerable,
    callable glyphs.
