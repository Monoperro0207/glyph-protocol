# Glyph — operational security

How to deploy a Glyph server safely. This is operational guidance; for what the
protocol's signatures do and do not *prove*, see [`trust.md`](trust.md).

## Server keys

A server signs every card and every receipt with an ed25519 key.

- **Provide a stable `keyPair`.** If you do not, `GlyphServer` generates an
  ephemeral one and warns. An ephemeral key changes on every restart, so
  previously issued cards and receipts no longer verify.
- **Protect the private key.** Treat it like any signing secret — load it from
  a secret manager or environment variable, never commit it.
- A compromised key cannot yet be revoked (see `trust.md`). Rotating it
  re-signs cards under a new identity; consumers that pinned the old key must
  be updated.

## Transport

The protocol is plain JSON over HTTP. Run the server behind TLS. Without it,
cards, inputs, outputs, and bearer tokens travel in clear text.

## Access control

- **Bearer auth** (`auth`) is a transport-level gate, not an identity system.
  It answers "may this caller reach the server", not "who is this caller".
  Pair it with a real identity layer if you need attribution.
- **Rate limiting** (`rateLimit`) is a fixed-window, in-memory limiter — it
  protects a single instance. Behind a load balancer, limit at the edge too.
- `GET /health` is intentionally never gated, so health checks keep working.

## Dangerous glyphs

- Set `cost.requiresConfirmation: true` on any glyph with irreversible or
  high-risk side effects. The server enforces the prepare/confirm/call flow —
  it is not advisory. See §6 of [`protocol.md`](protocol.md).
- Input and output are both validated against the card's schemas. A handler
  whose output breaks its own card is rejected with `OUTPUT_VALIDATION_FAILED`,
  so a misbehaving upstream cannot silently return an off-contract payload.

## Handler timeout

A call whose handler runs longer than `callTimeoutMs` (default 30s) is answered
with `504 HANDLER_TIMEOUT`. The server also **aborts** an `AbortSignal` it hands
to the handler via its context (`{ signal }`).

- A cooperating handler forwards that signal to `fetch`, child processes, or
  database drivers — so a timed-out call actually stops doing work.
- A handler that ignores the signal still **runs to completion in the
  background**; the timeout only frees the request, it is not forced
  cancellation. For glyphs with irreversible side effects, treat the signal as
  mandatory.

## Inert tool output

Tool output is treated as data, never instructions. The server sanitizes every
call result before delivery — stripping invisible Unicode (the tag block,
zero-width characters, bidirectional overrides) and C0/C1 control characters,
then applying NFKC normalization — and reports what it removed in the
envelope's `inspection` field. This deterministically defuses
invisible-character injection vectors. It does **not** stop a model from
obeying visible instructions embedded in a payload; see [`trust.md`](trust.md)
for that boundary.

## Adapted tools

Glyphs produced by `@glyphp/adapter-openapi` and
`@glyphp/adapter-mcp` derive their cost/risk metadata from the upstream
API or MCP server. **Upstream annotations are a suggestion, not authority.**
The MCP adapter raises the risk tier by a name heuristic (`delete`, `drop`,
`exec`, …) even when the tool claims to be read-only. Review adapted cards
before trusting their `cost`, and prefer `requiresConfirmation` when unsure.

## Audit

Pass an `onCall` hook to persist every signed `CallReceipt`. A stored receipt
is tamper-evident: anyone can later verify with `verifyReceipt()` that a given
input/output pair was produced by that server. The hook runs synchronously and
its exceptions are swallowed — keep it cheap, or hand off to a queue.
