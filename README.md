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
| `@glyph/adapter-mcp` | Convert an MCP server's tools into glyphs |

## Quick Start

```bash
pnpm install
cd examples/01-hello-glyph
pnpm server   # terminal 1
pnpm client   # terminal 2
```

## Examples

- [`01-hello-glyph`](examples/01-hello-glyph) — one glyph, end to end in under 2 minutes
- [`02-resolver-agent`](examples/02-resolver-agent) — multi-tool server + an agent
  that resolves natural-language intent to the right glyph
- [`03-mcp-filesystem`](examples/03-mcp-filesystem) — connects to a **real** MCP
  server, adapts its tools into glyphs, and calls one over the Glyph protocol

## Verify

```bash
pnpm typecheck   # type-check every package and the example
pnpm test        # run all package test suites
```

## Server hardening

`GlyphServer` accepts optional bearer-token auth and rate limiting — both off
by default, so they never get in the way of local development.

```typescript
const server = new GlyphServer({
  port: 3100,
  auth: { tokens: ['s3cret'] },          // or { verify: (token) => ... }
  rateLimit: { windowMs: 60_000, max: 100 },
})
```

`/health` stays public and unlimited so health checks keep working.

### Confirmation gate

A glyph whose card declares `cost.requiresConfirmation: true` cannot be
executed directly — the server enforces it, the metadata is not just advisory.
The caller must first obtain a single-use confirmation token, bound to that
exact glyph and input, from `POST /glyphs/:name/prepare`:

```typescript
const ticket = await client.prepare('book-flight', input)
// review ticket.cost — the risk summary — and approve, then:
await client.call('book-flight', input, {
  confirmationToken: ticket.confirmationToken,
})
```

A call to a `requiresConfirmation` glyph without a valid token gets `403`.
Tokens are single-use and expire after 5 minutes.

## Status

- **Phase 1 — complete.** Four packages + the `01-hello-glyph` example, typechecked and tested.
- **Phase 2 — complete.**
  - ed25519 signing: glyph cards carry an embedded public key and an ed25519
    signature over the card id; `verifyGlyph` checks both content integrity
    and provenance.
  - `@glyph/resolver`: natural-language intent → candidate glyphs, with a
    zero-dependency lexical scorer by default and an opt-in embedding scorer.
  - `@glyph/adapter-openapi`: turn any OpenAPI 3.x document into registerable,
    callable glyphs.
  - `@glyph/adapter-mcp`: turn any MCP server's tools into glyphs, mapping MCP
    annotations onto the glyph cost/risk model.
  - Server hardening: optional bearer-token auth and fixed-window rate limiting.
