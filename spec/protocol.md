# Glyph Protocol

**Protocol version:** `0.1` · **Status:** draft

Glyph is a connection protocol whose consumer is an LLM, not a deterministic
program. A tool publishes a **glyph card**: a self-describing, signed,
content-addressed description that carries not just an input/output schema but
also intent, cost, risk, and reversibility. This document is the normative
description of the wire protocol. The key words MUST, SHOULD, and MAY are used
in their RFC 2119 sense.

## 1. Concepts

- **Glyph** — one callable capability.
- **Glyph card** — the full description of a glyph. Its `id` is the SHA-256 of
  its canonical content, so the id changes if and only if the behavior-defining
  content changes. See [`schemas/glyph-card.schema.json`](schemas/glyph-card.schema.json).
- **Lexicon** — the compact list of every glyph a server offers, returned at
  handshake time and from `GET /lexicon`.
- **Session** — opened by a handshake. `sessionId` is informational in `0.1`;
  it is not required on subsequent requests.
- **Server** — hosts glyphs, signs cards, executes calls.
- **Consumer** — the client (typically an agent) that discovers and calls glyphs.

## 2. Transport

The protocol is JSON over HTTP. All request and response bodies are JSON with
`Content-Type: application/json`. A server SHOULD be deployed behind TLS; the
protocol defines no transport encryption of its own.

## 3. Protocol version negotiation

The protocol version (`0.1`) is the wire contract. It is distinct from any
server implementation or package version. While the protocol is `0.x`, every
minor is potentially breaking.

A consumer MUST send `protocolVersion` in the handshake. A server MUST reject
a handshake whose `protocolVersion` does not exactly match its own, with
`426 PROTOCOL_VERSION_UNSUPPORTED`. The error `details` carry
`serverProtocolVersion` and `clientProtocolVersion`.

## 4. Endpoints

### `GET /health`

Liveness probe. Public — it is never gated by auth or rate limiting. Returns
`{ "ok": true, "version": "<serverVersion>", "protocolVersion": "<version>" }`.
Lets a consumer discover the protocol version before a handshake.

### `POST /handshake`

Opens a session. Request body:
[`HandshakeRequest`](schemas/handshake-request.schema.json). Response:
[`HandshakeResponse`](schemas/handshake-response.schema.json), which includes
the `lexicon`. Errors: `426 PROTOCOL_VERSION_UNSUPPORTED`.

### `GET /lexicon`

Returns the lexicon: an array of
[`LexiconEntry`](schemas/lexicon-entry.schema.json).

### `GET /glyphs/:name`

Returns one glyph card. The optional `?depth=` query selects the card depth
(see §5); the default for this endpoint is `rich`. Errors: `404 NOT_FOUND`.

### `POST /glyphs/:name/prepare`

Obtains a confirmation ticket for a glyph that requires confirmation (see §6).
Request body: `{ "input": <value> }`. The server validates `input` against the
card's input schema. Response:
[`ConfirmationTicket`](schemas/confirmation-ticket.schema.json). Errors:
`404 NOT_FOUND`, `400 VALIDATION_FAILED`.

### `POST /glyphs/:name/call`

Executes a glyph. Request body:
`{ "input": <value>, "callId"?: string, "confirmationToken"?: string }`.

The server, in order: resolves the glyph (`404`), validates `input` against the
card's input schema (`400`), enforces the confirmation gate if required
(`403`), runs the handler under a timeout, then validates the handler's output
against the card's output schema. On success it returns a
[`SealedEnvelope`](schemas/sealed-envelope.schema.json) carrying the result and
a signed receipt.

Errors: `404 NOT_FOUND`, `400 VALIDATION_FAILED`, `403 CONFIRMATION_REQUIRED`,
`403 INVALID_CONFIRMATION`, `504 HANDLER_TIMEOUT`, `502 HANDLER_ERROR`,
`502 OUTPUT_VALIDATION_FAILED`.

## 5. Card depth

A consumer trades metadata richness against context budget. Depth values:

| Depth | Fields |
|---|---|
| `minimal` | `id`, `name`, `intent`, `input`, `output` |
| `standard` | `minimal` + `cost` + the first two `examples` |
| `rich` | the full card |

`glyph-card.schema.json` describes the `rich` card. `minimal` and `standard`
responses are strict subsets of it.

## 6. The confirmation flow

A glyph whose card declares `cost.requiresConfirmation: true` MUST NOT be
executed by a bare `POST /call`. The metadata is enforced, not advisory.

1. The consumer calls `POST /glyphs/:name/prepare` with the intended input.
2. The server validates the input and returns a `ConfirmationTicket` with a
   single-use `confirmationToken` bound to that exact glyph and input, and an
   `expiresAt` (the reference server uses a 5-minute TTL).
3. The consumer reviews `ticket.cost` and, if it approves, calls
   `POST /glyphs/:name/call` with the `confirmationToken`.

A token is consumed on use. A call to a `requiresConfirmation` glyph with no
token gets `403 CONFIRMATION_REQUIRED`; with an expired, already-used, or
mismatched token, `403 INVALID_CONFIRMATION`.

## 7. Errors

Every non-2xx response is a
[`GlyphError`](schemas/glyph-error.schema.json): `{ "error": { "code",
"message", "details"? } }`. `code` is stable and machine-readable; `message`
is human-readable and MUST NOT be matched on.

| Code | HTTP | Meaning |
|---|---|---|
| `PROTOCOL_VERSION_UNSUPPORTED` | 426 | Handshake protocol version mismatch |
| `NOT_FOUND` | 404 | No glyph with that name |
| `VALIDATION_FAILED` | 400 | Input failed the card's input schema |
| `CONFIRMATION_REQUIRED` | 403 | Glyph requires a confirmation token |
| `INVALID_CONFIRMATION` | 403 | Token expired, used, or mismatched |
| `HANDLER_TIMEOUT` | 504 | Handler exceeded the call timeout |
| `HANDLER_ERROR` | 502 | Handler threw |
| `OUTPUT_VALIDATION_FAILED` | 502 | Handler output failed the card's output schema |
| `UNAUTHORIZED` | 401 | Missing or invalid bearer token |
| `RATE_LIMITED` | 429 | Too many requests |

## 8. Integrity and receipts

On `register()`, a server signs the card's `id` with its ed25519 key and embeds
`publicKey` and `signature`. Every successful call also produces a signed
[`CallReceipt`](schemas/call-receipt.schema.json), returned inside the
`SealedEnvelope`. What these signatures do and do not prove is the subject of
[`trust.md`](trust.md).

## 9. Schemas

JSON Schema (draft 2020-12) for every wire message lives in
[`schemas/`](schemas). Each schema is self-contained.

## 10. Conformance

`@glyphp/conformance` is an executable suite that points at any Glyph
server and checks it against this document.
