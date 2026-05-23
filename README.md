# Glyph Protocol SDK

> A connection protocol designed from the ground up for LLM consumers.

Each tool publishes a **glyph** — a self-describing, signed, content-addressed card that carries not just the schema but also intent, cost, risk, and reversibility.

## Packages

| Package | Description |
|---|---|
| `@glyphp/types` | Pure TypeScript interfaces |
| `@glyphp/core` | Hash, sign, validate, sanitize |
| `@glyphp/server` | GlyphServer (Hono) |
| `@glyphp/client` | GlyphClient + the spotlighting render layer |
| `@glyphp/resolver` | Intent → glyph resolver (pluggable scorers) |
| `@glyphp/adapter-openapi` | Convert an OpenAPI document into glyphs |
| `@glyphp/adapter-mcp` | Convert an MCP server's tools into glyphs |
| `@glyphp/adapter-mcp-server` | Expose a Glyph server's tools to any MCP client |
| `@glyphp/conformance` | Executable spec conformance suite (`glyph-conformance`) |
| `@glyphp/cli` | Command-line tool (`glyph inspect` / `verify` / `diff-card` / `pins` / `approve` / `revoke` / `manifest` / `init`) |

> **Versioning** — the npm packages are versioned independently of the wire
> protocol. Package `0.x` releases implement **wire protocol `0.2`** (the
> `PROTOCOL_VERSION` constant). A client and server must agree on the *wire*
> version at the handshake, not on the package version.

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
- [`04-inert-data`](examples/04-inert-data) — a hostile glyph whose output
  smuggles a prompt injection, and how Glyph neutralizes it: sanitization, a
  signed inspection report, and the spotlighting render layer
- [`05-hermes-integration`](examples/05-hermes-integration) — full
  integration sandbox: Glyph→MCP bridge + DeepSeek-V4 Flash agent loop +
  native Python protocol test. Reproducible in Docker. See the audit report
  at [`spec/tests/hermes-deepseek.md`](spec/tests/hermes-deepseek.md)

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

`/health` stays public and unlimited so health checks keep working. The client
sends a matching token on every request:

```typescript
const client = new GlyphClient({
  baseUrl: 'http://localhost:3100',
  authToken: 's3cret',
})
```

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

### Audit receipts

Every successful call produces a **signed `CallReceipt`** — a tamper-evident
record of `{callId, glyphId, inputHash, outputHash, riskTier, latencyMs,
timestamp, provider}` signed with the server's ed25519 key. It rides back
inside the `SealedEnvelope` and is also handed to an optional audit hook:

```typescript
const server = new GlyphServer({
  onCall: (receipt) => auditLog.append(receipt), // persist it
})
```

Anyone can verify a receipt with `verifyReceipt()` from `@glyphp/core`. See
[`spec/trust.md`](spec/trust.md) for what the signatures do and do not prove.

### Production hardening checklist

Before exposing a Glyph server beyond local development:

- [ ] Pass a **stable `keyPair`** — an ephemeral key invalidates every issued
      card and receipt on restart.
- [ ] Run behind **TLS**; never serve the protocol in clear text.
- [ ] Enable **`auth`** and give the client a matching `authToken`.
- [ ] Set **`rateLimit`** — and rate-limit at the edge too behind a load balancer.
- [ ] Set `cost.requiresConfirmation: true` on every irreversible or high-risk
      glyph, and have handlers honour the timeout **`AbortSignal`**.
- [ ] Persist receipts via the **`onCall`** hook for a tamper-evident audit log.
- [ ] **Review adapted cards** — cost/risk derived from OpenAPI or MCP is a
      suggestion, not authority.

See [`spec/security.md`](spec/security.md) for the full operational guide.

## Inert data

The consumer of a glyph is an LLM, so a tool result is an injection surface:
hostile output can smuggle instructions. As of protocol `0.2`, Glyph treats
tool output as **inert data — never instructions** in two layers.

**Server-side sanitization.** Before delivery, the server strips provably
invisible or dangerous characters from every string in a result — the Unicode
tag block, zero-width characters, bidirectional overrides, C0/C1 controls —
and applies NFKC normalization. The `SealedEnvelope` carries an `inspection`
report of exactly what was removed, and the signed `CallReceipt` commits to it
via `inspectionHash`, so the cleaning is tamper-evident. `@glyphp/core`
exports the same step as a pure `sanitize()`.

**Client-side spotlighting.** `@glyphp/client` exports `renderEnvelope()` and
`dataPreamble()` — the recommended way to put a tool result in front of a
model. `renderEnvelope` wraps the payload in a per-render, cryptographically
random boundary nonce that untrusted content cannot predict, so a payload
cannot forge the closing marker and "break out" of the data channel.

```typescript
import { GlyphClient, renderEnvelope, dataPreamble } from '@glyphp/client'
import { verifyReceipt } from '@glyphp/core'

const envelope = await client.call('search', { q: 'glyph protocol' })

// Emit dataPreamble().content ONCE, as a trusted system message.
// Then hand the model the rendered block as the tool result:
const block = renderEnvelope(envelope, {
  verify: (e) => verifyReceipt(e.receipt!), // refuse to render unverified data
})
```

This raises the floor against prompt injection; it does not eliminate it. A
model can still choose to obey a visible instruction inside a clearly
delimited data block — see [`spec/trust.md`](spec/trust.md) for the limits.
[`04-inert-data`](examples/04-inert-data) shows both layers end to end.

## Update governance

A glyph card is content-addressed: any change to behavior-defining content
changes its `id`. So a tool that re-deploys with a wider blast radius — `safe`
→ `danger`, a new input field, a different provider — is *detectable*. Glyph
also lets a consumer **govern** that change instead of trusting it blindly.

**Card pinning.** Give `GlyphClient` a `PinStore` and it gates execution: it
verifies every card signature, pins the approved `(id, publicKey)` pair per
tool, and `call()` refuses any tool that is new, changed, or revoked — before
the handler ever runs.

The recommended production setup is **`secureMode: true` + `FilePinStore`** —
the client refuses to construct without a persistent pin store, so a tool that
has not been deliberately approved can never run:

```typescript
import { GlyphClient, FilePinStore } from '@glyphp/client'

const client = new GlyphClient({
  baseUrl: 'http://localhost:3100',
  pins: new FilePinStore(`${process.env.HOME}/.glyph/pins.json`),
  secureMode: true, // refuses to construct without a PinStore
})

const card = await client.getCard('refund-payment') // signature verified here
const { status, diff } = await client.inspectCard(card)

if (status !== 'unchanged') {
  // 'new'     — never approved
  // 'changed' — the card moved since approval; `diff` says what moved
  // 'revoked' — the consumer has explicitly distrusted this tool
  await client.approveCard(card) // the deliberate human-approval step
}

await client.call('refund-payment', input) // refused unless 'unchanged'
```

`MemoryPinStore` is fine for tests; for any deployed agent use
`FilePinStore` (atomic writes, JSON on disk) or implement the two-method
`PinStore` interface against your own database.

**Revocation.** `client.revokeTool(name, reason?)` blocks a tool for good; a
revoked tool is cleared only by an explicit
`approveCard(card, { reinstate: true })`. A revocation can never be lifted by
accident.

**Diffing.** `diffCards()` (from `@glyphp/core`) classifies how two cards
differ — `breaking` (cost/risk, schemas, provider, key) vs `review` (intent,
tags, examples). The CLI wraps it: `glyph diff-card <old> <new>` exits
non-zero on a breaking change, so CI can gate un-reviewed updates.

**Operating from the CLI.** Day-2 ops happen with `glyph`:

```bash
glyph pins list                          # show every pinned tool + status
glyph approve ./refund-payment.json      # write a pin after review
glyph approve ./card.json --reinstate    # clear a revocation deliberately
glyph revoke refund-payment --reason "rotation"
glyph manifest verify ./manifest.json    # check a signed UpdateManifest
```

Pins live at `~/.glyph/pins.json` by default; pass `--file <path>` for a
project-local store.

**Signed update manifests.** A provider can publish a signed `UpdateManifest`
with `server.registerManifest()` — an on-the-record statement of what
changed and why. `client.getManifest()` fetches and verifies it against the
*pinned* key (a manifest signed by a key the consumer never approved is
rejected). The endpoint is **optional and additive** — `PROTOCOL_VERSION`
stays `0.2`.

This governs the **card** — the declared contract. It cannot catch a provider
that keeps the card byte-identical and silently changes the handler's
behavior; that is an honest, documented limit (see
[`spec/update-governance.md §8`](spec/update-governance.md) and
[`spec/trust.md`](spec/trust.md)). Closing it requires execution attestation,
which is a separate, larger effort.

## Status

- **Phase 1 — complete.** Four packages + the `01-hello-glyph` example, typechecked and tested.
- **Phase 2 — complete.**
  - ed25519 signing: glyph cards carry an embedded public key and an ed25519
    signature over the card id; `verifyGlyph` checks both content integrity
    and provenance.
  - `@glyphp/resolver`: natural-language intent → candidate glyphs, with a
    zero-dependency lexical scorer by default and an opt-in embedding scorer.
  - `@glyphp/adapter-openapi`: turn any OpenAPI 3.x document into registerable,
    callable glyphs.
  - `@glyphp/adapter-mcp`: turn any MCP server's tools into glyphs, mapping MCP
    annotations onto the glyph cost/risk model.
  - Server hardening: optional bearer-token auth and fixed-window rate limiting.
- **Protocol `0.2` — current.** Inert-data hardening: server-side
  sanitization, a signed inspection report on every envelope, and the
  `@glyphp/client` spotlighting render layer. This is a breaking wire change —
  `0.1` peers are rejected at the handshake with `426`.
- **Update governance — current.** Consumer-side card pinning, a tool
  lifecycle (approve / review on change / revoke), `diffCards`, and an optional
  signed `UpdateManifest`. Additive — no wire-protocol change.

## Spec

The wire protocol is documented in [`spec/`](spec):

- [`protocol.md`](spec/protocol.md) — endpoints, handshake, card depth, the
  confirmation flow, the inert-data inspection report, and the error model.
- [`schemas/`](spec/schemas) — JSON Schema (draft 2020-12) for every wire message.
- [`trust.md`](spec/trust.md) — the trust model: what the signatures prove.
- [`update-governance.md`](spec/update-governance.md) — pinning, the tool
  lifecycle, and signed update manifests.
- [`security.md`](spec/security.md) — deploying a server safely.

## License

Licensed under the [Apache License, Version 2.0](LICENSE) — code, SDK, and the
[`spec/`](spec) directory. The Apache 2.0 patent grant lets anyone build
independent implementations of the Glyph Protocol with confidence. See
[`NOTICE`](NOTICE) for attribution.

The Apache License does not grant rights to the "Glyph Protocol" name or
branding, which Patrick Espino reserves as the project's marks.
