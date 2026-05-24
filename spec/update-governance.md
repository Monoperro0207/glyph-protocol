# Glyph Protocol — Update governance & tool lifecycle

**Status:** tracks the current implementation. §§1–6 are realized by
`@glyphp/client`; §7 (the signed update manifest) is realized by
`@glyphp/server` and `@glyphp/client` as an **optional, additive** endpoint —
it does not change the handshake-negotiated protocol contract, so
`PROTOCOL_VERSION` is `1.0`. The key words MUST, SHOULD, and MAY are used in
their RFC 2119 sense.

This document covers what happens *after* a tool a consumer once trusted
changes. Card integrity ([`protocol.md §8`](protocol.md)) and the trust model
([`trust.md`](trust.md)) are prerequisites.

## 1. The problem

A glyph card's `id` is the SHA-256 of its canonical content, so the id changes
if and only if behavior-defining content changes. The protocol therefore
*detects* a changed card. It does not, on its own, *govern* the update.

A consumer that approved `refund-payment` once will, on the next handshake,
silently receive whatever `refund-payment` now resolves to. If the provider
re-deployed the tool with a wider blast radius — `riskTier` `safe` → `danger`,
a new `input` field, a different `provider` — nothing in the wire protocol stops
the agent from calling it. "Same name" is being treated as "same tool". It is
not.

## 2. Principle — a verified card is immutable

> A verified card is never *updated*. If anything relevant changes, the `id`
> changes, and for the consumer that is a **new tool that must earn trust
> again**.

A card is a content-addressed value. There is no in-place edit: a "v2" is a
different card with a different id. The consumer's job is not to track a
mutable tool through versions, but to decide, each time an id it has not
approved appears under a familiar name, whether to approve it.

## 3. The pinned identity — `(id, publicKey)`

A consumer records its approval as a **pin**: the exact card it approved for a
tool name. The pinned identity is the pair `(card.id, card.publicKey)`.

Both halves are required:

- The `id` covers content. It deliberately **excludes** `publicKey` — so a
  provider can rotate signing keys without re-issuing every card. A
  consequence: `verifyGlyph()` proves a card is *internally consistent*
  (content hashes to its id, signature matches the embedded key) — it does
  **not** prove the card came from the provider you approved. Any party can
  mint a self-consistent card with its own key.
- Pinning `publicKey` alongside `id` is what turns "internally consistent" into
  "the exact card, from the exact key, that I approved". A change to *either*
  is a trust event.

A consumer MUST compare both `id` and `publicKey` against the pin. A consumer
MUST NOT treat an id match alone as sufficient.

## 4. Lifecycle — a consumer-side model

A tool's trust state is **not a property of the card**. A card cannot be
trusted to declare its own trustworthiness, and a provider re-deploying a tool
has every incentive to keep declaring it `stable`. Trust is a relationship the
*consumer* holds. The authoritative lifecycle state therefore lives in the
consumer's pin store, never on the wire.

| State | Condition | Execution |
|---|---|---|
| `unknown` | no pin exists for this tool name | blocked |
| `approved` | a pin exists and `(id, publicKey)` both match | allowed |
| `changed` | a pin exists but `id` or `publicKey` differs | blocked — pending review |
| `revoked` | the consumer has explicitly distrusted this tool | blocked — re-approval must be deliberate |

The reference client (`@glyphp/client`) implements `unknown`, `approved`, and
`changed` today; `revoked` is a thin future addition (a consumer-side flag the
pin store carries, checked before execution).

Provider-side maturity labels — `draft`, `stable`, `deprecated` — are
deliberately **not** lifecycle states here. They MAY appear as advisory card
metadata in a future revision, but they never gate execution. Only the four
states above do.

## 5. Detecting and triaging a change

The id flip is the **detector**: any canonical-field change already produces a
new id, with no diff required. `diffCards()` (in `@glyphp/core`) is the
**explainer** — it tells a human *what* moved so they can decide whether to
re-approve. Each change is classified:

| Severity | Fields | Meaning |
|---|---|---|
| `breaking` | `version`, `idempotent`, `input`, `output`, `provider`, `publicKey`, `cost.sideEffects`, `cost.reversible`, `cost.riskTier`, `cost.requiresConfirmation` | A contract- or security-relevant change. Execution MUST NOT resume without human re-approval. |
| `review` | `name`, `intent`, `tags`, `examples`, `failureModes`, `cost.latency` | A descriptive change. Worth a look; not a gate. |

`CardDiff.requiresApproval` is `true` whenever any change is `breaking`. A
consumer MUST require explicit human re-approval before executing a tool whose
diff `requiresApproval`.

## 6. The approval flow

The reference client realizes the model as follows:

1. **Discover.** `connect()` returns the lexicon. `inspectLexicon()` classifies
   every entry against the pin store by `id` alone — a cheap early signal,
   before any card is fetched. (It cannot see a key swap; the lexicon carries
   no `publicKey`.)
2. **Fetch.** `getCard()` retrieves the rich card and verifies its signature.
   A present-but-invalid signature is rejected outright.
3. **Inspect.** `inspectCard()` returns `new`, `unchanged`, or `changed`, with
   a `diff` for a changed card. It never throws — it reports.
4. **Approve.** For a `new` or `changed` tool, a human reviews the card (and,
   for `changed`, the diff). `approveCard()` re-verifies the signature and
   writes the pin. This is the only step that grants trust.
5. **Call.** `call()` enforces the gate: a tool that is not `approved` (i.e.
   `new`, `changed`, or `revoked`) is refused with `GlyphNotApprovedError`
   *before* the handler runs. No pin store configured ⇒ no gate (the gate is
   opt-in and backward compatible).

A consumer MAY surface a `new`/`changed` tool to a human or an agent for
*inspection*; it MUST NOT *execute* it until it is `approved`.

## 7. Signed update manifest

The diff in §5 tells a consumer *what* changed. It cannot tell them *why*, or
whether the provider considers the change deliberate and safe. An optional
**update manifest** lets a provider make a signed, on-the-record statement
about an update. It is additive: a server that never publishes one, and a
consumer that never asks, both behave exactly as before.

### 7.1 Shape

```ts
interface UpdateManifest {
  manifestVersion: string          // wire version of the manifest format ("0.1")
  toolName: string
  previousCardId: string
  newCardId: string
  reason: string                   // human-readable description of the change
  breaking: boolean                // the provider's own claim
  securityImpact: 'none' | 'low' | 'high'
  issuedAt: string                 // ISO 8601
  serverPublicKey: string
  signature: string                // ed25519 over the canonical hash of the
                                   // manifest with `signature` removed
}
```

The manifest is signed exactly like a `CallReceipt`: `canonicalHash()` of every
field except `signature`, signed with the server's ed25519 key. Its JSON Schema
is [`schemas/update-manifest.schema.json`](schemas/update-manifest.schema.json).

### 7.2 Who signs it, and the limit that follows

The manifest is signed by the **server key** — the same key that signs cards.
The protocol has no separate provider key today; `provider` is a string claim
(see [`trust.md`](trust.md)). A genuine provider-attested manifest belongs to
the trust-registry workstream and is out of scope here.

A direct consequence: **a manifest is only meaningful when signed by the
already-pinned key.** If an update *also* changes `publicKey`, a manifest signed
by the *new* key proves nothing — an attacker who swapped the key would simply
sign their own manifest. A consumer MUST verify a manifest against the pinned
`publicKey`, not against the key embedded in the new card. A key change cannot
be self-certified; it requires out-of-band trust establishment.

### 7.3 Delivery

The manifest is served from an optional endpoint
`GET /glyphs/:name/manifest`. A server publishes one with `registerManifest()`;
a server that never does returns `404 NOT_FOUND`, which is **not** an error
condition — a consumer that finds no manifest falls back to full re-review
(§6). The endpoint introduces no handshake or wire-contract change, so it
carries no protocol version bump. `@glyphp/client.getManifest()` fetches it and
applies the verification of §7.2, returning `undefined` when none is published.

An out-of-band published artifact (a signed file released alongside the tool)
was considered; the endpoint is preferred because it is discoverable and rides
the same transport and key as the card.

### 7.4 What the manifest does and does not do

A manifest **informs** human review; it does not **replace** it. A
`breaking` diff keeps `requiresApproval: true` regardless of what the manifest
says — `securityImpact: "none"` is a provider claim, not proof. The manifest's
value is an audit trail and faster triage for honest providers, not a trust
bypass.

## 8. What this does not solve

Pinning, diffing, and the manifest all govern the **card** — the declared
contract. None of them covers the **handler implementation** behind it.

A provider that keeps a card byte-identical and silently changes what the
handler does — e.g. `search-docs` still returns `{ results: [...] }` but now
also exfiltrates its input — produces the **same id and the same signature**.
It is invisible to pinning, to `diffCards()`, and to a manifest.

Closing that gap requires *execution attestation*: evidence of which code ran
(a signed build digest, a source commit, a container digest, or formal
provenance). That is a distinct, larger effort that needs cooperation from
build systems and runtimes — the same class of problem as host-enforced inert
data; see [`trust.md`](trust.md).

A card MAY carry an optional `attestation` envelope (a `{type, payload}` pair,
opaque to the SDK). Because it is canonical, any change to it changes the
`id`, and `diffCards()` classifies a change as `breaking` — so an attestation
that moves cannot ride past a pin. The SDK ships `verifyAttestation()`, which
only checks the envelope is well-formed; verifying the payload against a
trust root (Sigstore, SLSA verifier, an in-toto policy, a private registry)
is the consumer's responsibility, because the SDK cannot certify its own
host process. This is the structural limit: a program cannot attest to its
own integrity — only an external authority can.

## 9. Consumer obligations (summary)

- A consumer that gates execution MUST pin `(id, publicKey)` per approved tool.
- A consumer MUST block execution of any tool not in state `approved`.
- A consumer MUST require human re-approval when a diff `requiresApproval`.
- A consumer MUST verify an update manifest against the *pinned* key.
- A consumer MUST NOT treat a manifest, or a provider maturity label, as a
  substitute for reviewing a breaking change.

## License

This specification is licensed under the Apache License, Version 2.0. See
[`LICENSE`](../LICENSE).
