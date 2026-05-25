# Glyph Protocol

> **Signed, content-addressed tool contracts for AI agents.**
>
> Every tool publishes a **glyph** — a self-describing, cryptographically signed card that carries not just the schema but also intent, cost, risk, and reversibility. Agents discover glyphs, verify their signatures, and execute tools with audit-grade receipts. No blind function calling. No trust-without-verify.

[![wire protocol](https://img.shields.io/badge/wire%20protocol-1.0%20stable-2ea44f)](spec/protocol.md)
[![npm core](https://img.shields.io/npm/v/@glyphp/core?label=%40glyphp%2Fcore)](https://www.npmjs.com/package/@glyphp/core)
[![npm server](https://img.shields.io/npm/v/@glyphp/server?label=%40glyphp%2Fserver)](https://www.npmjs.com/package/@glyphp/server)
[![npm integrations](https://img.shields.io/npm/v/@glyphp/integration-vercel-ai?label=%40glyphp%2Fintegration--*)](https://www.npmjs.com/org/glyphp)
[![npm exporter-otel](https://img.shields.io/npm/v/@glyphp/exporter-otel?label=%40glyphp%2Fexporter--otel)](https://www.npmjs.com/package/@glyphp/exporter-otel)
[![Python SDK](https://img.shields.io/pypi/v/glyph-protocol?label=pypi%20glyph-protocol)](https://pypi.org/project/glyph-protocol/)
[![Go SDK](https://img.shields.io/badge/go%20sdk-v1.0.0-00ADD8)](sdks/go/glyphprotocol)
[![conformance](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2FMonoperro0207%2Fglyph-protocol%2Fmain%2Fdocs%2Fconformance-badge.json)](packages/conformance)
[![CI](https://github.com/Monoperro0207/glyph-protocol/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Monoperro0207/glyph-protocol/actions/workflows/ci.yml)

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
| `@glyphp/conformance` | Executable spec conformance suite (`glyph-conformance`) — 4 levels |
| `@glyphp/cli` | Command-line tool (`glyph inspect` / `verify` / `diff-card` / `pins` / `approve` / `revoke` / `manifest` / `init` / `keys`) |

### Framework integrations

| Package | Description |
|---|---|
| `@glyphp/integration-vercel-ai` | Expose glyphs as tools for the Vercel AI SDK |
| `@glyphp/integration-langchain` | Expose glyphs as LangChain `StructuredTool`s |
| `@glyphp/integration-llamaindex` | Expose glyphs as LlamaIndex.TS `FunctionTool`s |
| `@glyphp/integration-openai-agents` | Expose glyphs as OpenAI Agents SDK tools |

### Non-TypeScript SDKs

| SDK | Status | Path |
|---|---|---|
| Python (verify + client) | 1.0 | [`sdks/python/`](sdks/python/) — `pip install glyph-protocol` |
| Go (verify + client) | 1.0 | [`sdks/go/glyphprotocol/`](sdks/go/glyphprotocol/) |

All SDKs are tested against the **canonical test vectors** under
[`spec/canonical/`](spec/canonical/), so a card canonicalised, hashed,
signed or sanitised in one SDK verifies byte-identically in any of the
others.

> **Versioning** — the npm packages are versioned independently of the wire
> protocol. Package `1.x` releases implement **wire protocol `1.0`** (the
> `PROTOCOL_VERSION` constant). A client and server must agree on the *wire*
> version at the handshake, not on the package version.

## Quick Start

Requirements: Node `>=20` and pnpm pinned via Corepack (see `packageManager`
in `package.json`). One command sets up the toolchain and validates the
entire repo end-to-end:

```bash
corepack enable
pnpm install
pnpm verify         # typecheck + test + build + smoke + conformance
```

### Scaffold a new project

The `glyph init` CLI scaffolds with the `production-server` profile by
default — stable key pair, bearer-token auth, rate limiting and a pin
store baked in. That's the recommended starting point for anything you
plan to deploy:

```bash
pnpm exec glyph init my-server
cd my-server && pnpm install && pnpm start
```

For a 2-minute tour with no setup (ephemeral key, no auth — prototyping
only) run the `01-hello-glyph` example instead:

```bash
cd examples/01-hello-glyph
pnpm run server   # terminal 1
pnpm run client   # terminal 2
```

If you also have Python and Go installed, `pnpm verify:full` additionally
exercises the Python and Go SDKs against the canonical test vectors in
`spec/canonical/`.

### Map existing MCP servers automatically

If you already have MCP servers configured in Claude Desktop, Cursor, or
Codex, `glyph import mcp` reads that config, connects to each server,
and generates a Glyph bridge project per MCP — signed cards, cost/risk
inferred from MCP annotations, confirmation gate already wired:

```bash
pnpm exec glyph import mcp                       # interactive picker
pnpm exec glyph import mcp --from claude-desktop # all MCPs in your Claude Desktop config
pnpm exec glyph import mcp --command "npx -y @modelcontextprotocol/server-everything"
```

Output: `glyph-imports/<name>/server.ts` per MCP plus a markdown
`IMPORT_REPORT.md` listing what was imported, what was skipped (with
the exact reason — missing env var, timeout, etc.), and which cards the
heuristic tagged as `caution`/`danger` for review. See
[`spec/rfcs/RFC-0004-import-clients.md`](spec/rfcs/RFC-0004-import-clients.md)
for which client adapters are stable today vs. pending verification.

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
hostile output can smuggle instructions. As of protocol `1.0`, Glyph treats
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
rejected). The endpoint is **optional and additive** under `PROTOCOL_VERSION`
`1.0`.

This governs the **card** — the declared contract. It cannot catch a provider
that keeps the card byte-identical and silently changes the handler's
behavior; that is an honest, documented limit (see
[`spec/update-governance.md §8`](spec/update-governance.md) and
[`spec/trust.md`](spec/trust.md)). Closing it requires execution attestation,
which is a separate, larger effort.

## Status

### Version matrix

Wire protocol `1.0` (stable) interoperates with npm `@glyphp/* 1.x`, Python
`glyph-protocol 1.0.x`, and Go `glyphprotocol v1.0.x`. See
[`docs/versioning.md`](docs/versioning.md) for the full matrix and
compatibility policy.

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
- **Protocol `1.0` — current, stable.** First stable wire-protocol line.
  Inert-data hardening (server-side sanitization + signed inspection report +
  spotlighting render layer), strict `depth` enum, distinct
  `CONFIRMATION_REQUIRED` / `INVALID_CONFIRMATION` codes, new
  `MALFORMED_JSON` / `INTERNAL_ERROR` / `KEY_REVOKED` error codes, optional
  `GET /keys` key registry endpoint, and adapter output validation by default
  in `@glyphp/adapter-mcp` and `@glyphp/adapter-openapi`. Earlier `0.x` peers
  are rejected at the handshake with `426`.
- **Update governance — current.** Consumer-side card pinning, a tool
  lifecycle (approve / review on change / revoke), `diffCards`, and an optional
  signed `UpdateManifest`. Additive — no wire-protocol change.
- **Key rotation & revocation — current.** Optional `GET /keys` endpoint and
  `KeyRegistry` (file or HTTP) verify cards and receipts across rotation, and
  reject keys flagged in the revocation list with `401 KEY_REVOKED`. See
  [`spec/rfcs/RFC-0001-key-registry.md`](spec/rfcs/RFC-0001-key-registry.md).

## Conformance

`@glyphp/conformance` ships a four-level executable suite — `discovery`,
`execution`, `security`, `governance` — that produces a versioned JSON
badge a server can publish:

```bash
pnpm exec glyph-conformance https://your-server.example \
  --level all \
  --fixture-echo conformance-echo \
  --fixture-requires-confirmation conformance-requires-confirmation \
  --fixture-slow conformance-slow \
  --fixture-invalid-output conformance-invalid-output \
  --output report.json --markdown report.md
```

`@glyphp/conformance` also exposes `registerFixtures(server)` —
register the standard fixture glyphs and external auditors can exercise
all four levels against your deployment. See
[`scripts/conformance-self.mjs`](scripts/conformance-self.mjs) for a
worked example.

## Spec

The wire protocol is documented in [`spec/`](spec):

- [`protocol.md`](spec/protocol.md) — endpoints, handshake, card depth, the
  confirmation flow, the inert-data inspection report, and the error model.
- [`schemas/`](spec/schemas) — JSON Schema (draft 2020-12) for every wire message.
- [`trust.md`](spec/trust.md) — the trust model: what the signatures prove.
- [`update-governance.md`](spec/update-governance.md) — pinning, the tool
  lifecycle, and signed update manifests.
- [`security.md`](spec/security.md) — deploying a server safely.
- [`threat-model.md`](spec/threat-model.md) — STRIDE threat model: assets,
  trust boundaries, abuse cases, and what is explicitly out of scope.
- [`canonical/`](spec/canonical) — cross-SDK test vectors (hashing,
  canonicalisation, signatures, sanitization).
- [`rfcs/`](spec/rfcs) — protocol RFCs:
  [RFC-0001 — Key Registry, Rotation and Revocation](spec/rfcs/RFC-0001-key-registry.md),
  [RFC-0002 — Scope-based Policy Layer](spec/rfcs/RFC-0002-policy-layer.md),
  [RFC-0003 — Public Providers Registry](spec/rfcs/RFC-0003-public-registry.md).

## Project documentation

- [`CHANGELOG-PROTOCOL.md`](CHANGELOG-PROTOCOL.md) — wire-protocol changelog.
- [`GOVERNANCE.md`](GOVERNANCE.md) — roles, versioning, RFC process.
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — setup, where things live, conventions.
- [`SECURITY.md`](SECURITY.md) — supported versions, disclosure policy.
- [`docs/why-glyph.md`](docs/why-glyph.md) — when to use Glyph vs MCP /
  OpenAPI / function-calling.
- [`docs/deployment.md`](docs/deployment.md) — operational checklist,
  Docker, secrets, observability.
- [`docs/release-verification.md`](docs/release-verification.md) — verifying
  npm provenance, cosign signatures and SBOMs for `@glyphp/*` releases.
- [`docs/versioning.md`](docs/versioning.md) — wire/SDK version matrix and
  compatibility policy.
- [`bench/`](bench) — reproducible multi-model benchmark (maintainer-run).

## License

Licensed under the [Apache License, Version 2.0](LICENSE) — code, SDK, and the
[`spec/`](spec) directory. The Apache 2.0 patent grant lets anyone build
independent implementations of the Glyph Protocol with confidence. See
[`NOTICE`](NOTICE) for attribution.

The Apache License does not grant rights to the "Glyph Protocol" name or
branding, which Patrick Espino reserves as the project's marks.
