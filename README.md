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

## Quick Start

```bash
pnpm install
cd examples/01-hello-glyph
pnpm server   # terminal 1
pnpm client   # terminal 2
```

## Status

Phase 1 — MVP in progress.
