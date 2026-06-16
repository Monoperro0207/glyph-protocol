# RFC-0009: Publisher Identity (making `provider` a cryptographic claim)

- **Status:** Draft (spec only, no implementation in this RFC)
- **Targets:** Glyph Protocol 1.x (additive, backwards-compatible)
- **Author:** Glyph Protocol
- **Created:** 2026-06-09
- **Updated:** 2026-06-13 — `subjectCardId` redefined over the
  **attestation-exclusive** canonical id (§3.1.1). The original definition
  (the card's content-addressed id) was unsatisfiable: the binding lives inside
  `card.attestation`, which itself enters `card.id`, so no binding could commit
  to the id that contains it. Mirrors RFC-0007 §3.1.1.

## 1. Motivation

A glyph passes through up to three parties ([`../trust.md`](../trust.md)):

| Role | Who | Modeled today |
|---|---|---|
| **Publisher** | Whoever authored the tool's behavior | `GlyphCard.provider` — a **string** |
| **Server** | The Glyph server that hosts and signs the card | `publicKey` / `signature` (RFC-0001) |
| **Executor** | Whatever the handler ultimately calls | not modeled — see RFC-0008 |

The Server identity is cryptographic: `verifyGlyph()` proves *a key* signed the
card, and the Key Registry (RFC-0001) lets that key rotate and be revoked. The
**Publisher is not**: `provider` is a free string the signer can set to
anything. `verifyGlyph()` on a card with `provider: "acme.payments"` proves only
that *some* key signed *some* content that contains that string — never that
ACME, the real-world publisher, authored or authorized the tool.

The gap is widest for **adapted** glyphs. With `defineGlyph`, publisher = server
(same party, same key). But `@glyphp/adapter-openapi` and `@glyphp/adapter-mcp`
mint cards whose `provider` names an *upstream* API/MCP server while a *different*
Glyph server signs them. Today the two are distinguishable only by inspection;
nothing lets a consumer verify "this card really represents ACME's API."

This is the trust-root gap `trust.md` calls out ("Treat `provider` as a claim")
and the audit flagged as a P0 alongside execution attestation (RFC-0008). This
RFC closes the **Publisher↔Server** half: it gives the Publisher a cryptographic
identity and a signed binding to the cards (or server keys) it stands behind, so
a consumer can verify *who authored* a tool independently of *who signed* it.

This RFC implements nothing.

## 2. Non-goals

- **A global name authority.** Like RFC-0003, this does not create a central
  namespace. A Publisher identity is a *key* (or an OIDC identity, §3.3), and
  human-readable names map to keys through a registry the consumer chooses to
  trust — never a single blessed root.
- **Closing the Executor gap.** "What code runs behind the card" is RFC-0008's
  domain. RFC-0009 answers "who authored the card", a different axis. They
  compose; neither subsumes the other.
- **Replacing the Server signature or Key Registry.** The ed25519 `signature`,
  RFC-0001 rotation/revocation, RFC-0007 keyless, and RFC-0008 attestation are
  all unchanged. Publisher identity is an *additional, orthogonal* layer.
- **Forcing publisher verification.** It stays opt-in. A card with no publisher
  binding, and a consumer that never asks for one, behave exactly as today.

## 3. Wire format

A Publisher identity is a key pair (ed25519, like the rest of the protocol) or a
keyless OIDC identity (RFC-0007). A **publisher binding** is a signed statement
that ties that identity to the cards it authored. Two delivery modes, both
additive; a deployment MAY use either or both.

### 3.1 Per-card binding (rides the attestation hook)

The publisher signs a statement over the card's id (specifically its
attestation-exclusive canonical id, §3.1.1) and delivers it in the existing
`CardAttestation` envelope (RFC-0008) with a registered `type`:

```json
{
  "attestation": {
    "type": "publisher-identity-v1",
    "payload": "<base64 of the publisher binding, see below>",
    "reference": "<optional URL to the publisher's identity document>"
  }
}
```

The binding (canonical JSON, base64-encoded into `payload`):

```json
{
  "bindingVersion": "publisher-identity-v1",
  "provider": "acme.payments",
  "subjectCardId": "<the card's attestation-exclusive canonical id — see §3.1.1>",
  "publisherKey": "<ed25519 public key of the publisher, hex>",
  "signature": "<ed25519 over the canonical hash of this binding minus `signature`>"
}
```

- `subjectCardId` binds the statement to *this* card: it is the card's
  **attestation-exclusive** canonical id (§3.1.1), the analogue of RFC-0007's
  `subjectDigest` — RFC-0009 binds the id itself rather than its SHA-256. A
  binding lifted onto a card with different content fails this check, so it
  cannot be replayed.
- `provider` MUST equal the card's `provider`; a verifier rejects a mismatch.
- The `attestation` envelope is canonical content, so it still enters the
  **final** card `id`: adding, swapping, or stripping a binding changes `id` and
  is a `breaking` diff — a publisher binding cannot slip past a pin (RFC-0008 §6).

The publisher key is **distinct** from the server `publicKey`. For an adapted
glyph the upstream API owner holds the publisher key; the Glyph server holds the
signing key. For `defineGlyph` they MAY be the same key.

#### 3.1.1 The subject id and the id fixed point

The card's content-addressed `id` (RFC: `computeGlyphId`) covers the
`attestation` field — an attested card and its unattested twin are different
tools. But the publisher binding *is* the attestation payload: a binding whose
`subjectCardId` was "the card's content-addressed id" would have to contain the
very id that contains it, and no such fixed point exists. The original draft of
this RFC required exactly that, which made a card that passes both
`verifyGlyph()` and publisher verification unconstructible — the same
contradiction RFC-0007 §3.1.1 hit for keyless `subjectDigest`.

The resolution is identical, and mirrors the ed25519 path (the canonical id
*excludes* `signature`/`publicKey` so the signature can commit to the id without
containing itself). The binding commits to the id computed with the slot that
carries *its* proof removed:

> **`subjectCardId` = the card's canonical id computed with the `attestation`
> slot absent** (the *attestation-exclusive id*). All other canonical fields are
> covered. For a card without an attestation the attestation-exclusive id and
> `card.id` coincide.

RFC-0009 binds the **id itself** (string equality), where RFC-0007 binds its
SHA-256: the fixed-point problem and its resolution are the same; only the
representation differs. Binding the plain id keeps the value human-legible in
the binding, and the binding is itself signed, so it needs no extra hashing.

The final `card.id` still includes the attestation, so the published card
remains tamper-evident end to end: the binding commits to the behavioral
content, and the id commits to the content *plus* the binding. Producers compute
`subjectCardId` on the card content *before* attaching the `attestation`
envelope; verifiers recompute it from the received card (never read from
`card.id`). This is the analogue of `keylessSubjectDigest()` in `@glyphp/core`,
minus the SHA-256 step.

### 3.2 Per-provider binding (extends the public registry, RFC-0003)

Signing every card is impractical for a publisher who authorizes a server to
mint many cards on their behalf. Instead the publisher signs **once** a
delegation that authorizes a set of server keys:

```json
{
  "delegationVersion": "publisher-identity-v1",
  "provider": "acme.payments",
  "publisherKey": "<ed25519 public key of the publisher, hex>",
  "authorizedServerKeys": ["<server publicKey hex>", "..."],
  "validUntil": "<ISO 8601, optional>",
  "signature": "<ed25519 over the canonical hash minus `signature`>"
}
```

A consumer that trusts `publisherKey` for `provider` then accepts any card whose
`provider` matches **and** whose server `publicKey` is in `authorizedServerKeys`.
This is the cryptographic upgrade of RFC-0003's directory entry: RFC-0003 maps a
provider name to an `(endpoint, publicKey)`; this lets the *publisher* — not just
the registry author — sign which server keys speak for them. Delegations MAY be
distributed in an RFC-0003 registry document or served from a publisher endpoint.

### 3.3 Keyless publishers (composes with RFC-0007)

A publisher who would rather not hold a key MAY use a keyless OIDC identity: the
`publisherKey` field is replaced by an RFC-0007 `glyph-keyless-v1` bundle whose
`identity` (e.g. `repo:acme/payments-tools`) *is* the publisher identity. The
verification then delegates to the keyless verifier (RFC-0007 §4.2) for the
identity proof, and this RFC's subject binding (§4) for the card linkage.

## 4. Trust model & verification contract

A consumer resolves publisher identity through layers, fail-closed on any miss,
stopping at the first that satisfies its policy:

1. **Pin (TOFU or explicit).** If the consumer already pinned a publisher
   identity for this `provider`, that pin is authority — no network, no config.
   A later change to the bound publisher key is a trust event, exactly like a
   server key change (RFC-0001 §5, update-governance §3).
2. **Per-card binding (§3.1).** Verify, in order:
   1. `subjectCardId` equals the card's attestation-exclusive canonical id
      (§3.1.1), **recomputed from the received card's content** — never compared
      against `card.id`, which for an attested card covers the binding and so
      never matches (content integrity of `card.id` itself remains
      `verifyGlyph`'s check);
   2. `provider === card.provider`;
   3. the binding `signature` verifies against `publisherKey` (or, for §3.3, the
      keyless bundle verifies per RFC-0007).
3. **Per-provider delegation (§3.2).** Verify the delegation `signature` against
   the trusted `publisherKey`, then check `card.publicKey ∈ authorizedServerKeys`
   and `provider` matches and the delegation is unexpired.

A binding that verifies establishes **`provider` is authentic** — the named
publisher really stands behind this card. It says nothing about the tool's
*safety* (that remains the cost/risk fields + the consumer's pin gate) or about
*what code runs* (RFC-0008). As with every other layer, an unrecognised or
absent binding falls back to today's behavior: `provider` is treated as an
unverified string.

### 4.1 Relationship to the other layers

- **Server signature / Key Registry (RFC-0001):** proves *who signed*. Publisher
  identity proves *who authored/authorized*. For adapted glyphs these are
  genuinely different parties; this RFC is what makes the difference verifiable.
- **Public registry (RFC-0003):** a *directory* (a recommendation). A publisher
  delegation (§3.2) is a *cryptographic authorization* by the publisher itself —
  stronger than inclusion in someone's list. They compose: a registry MAY carry
  delegations.
- **Execution attestation (RFC-0008):** orthogonal axis (which code runs). A card
  MAY carry both a `publisher-identity-v1` and an execution attestation; each is
  verified independently.

## 5. CLI & API surface (specified, implemented later)

- `glyph verify <card> --publisher` — runs the §4 layered check and reports the
  verified publisher identity (or that the card carries only an unverified
  `provider` string).
- A `PublisherVerifier implements AttestationVerifier` (the RFC-0008 interface)
  for the per-card mode, registrable alongside the other verifiers.
- `GlyphClient` gains an optional publisher pin alongside the `(id, publicKey)`
  pin, and a `requirePublisher: 'none' | 'danger' | 'all'` policy mirroring
  `requireAttestation`.
- No change to `signGlyph`, `verifyGlyph`, `computeGlyphId`, the wire protocol
  version, or the card schema (the binding reuses the `attestation` envelope).

## 6. Security considerations

- **Trust-root regress (state it).** Publisher identity *moves* the trust
  question from "is this string honest?" to "do I trust this publisher key?",
  it does not remove it. The consumer must still establish the publisher key out
  of band (TOFU, a trusted registry, or a keyless issuer). This RFC makes the
  binding verifiable; it does not mint trust from nothing.
- **Key vs. server-key confusion.** A verifier MUST treat the publisher key and
  the server `publicKey` as distinct. Accepting a publisher binding signed by the
  *server* key for an adapted glyph would defeat the purpose — it would let the
  signer self-certify as the publisher. For `defineGlyph` a deployment MAY
  declare them equal explicitly; a verifier MUST NOT *assume* it.
- **Replay / stripping.** The per-card `subjectCardId` binding prevents lifting a
  binding onto another card; canonical inclusion makes adding/removing the
  binding a new `id` and a `breaking` diff, so it cannot slip past a pin.
- **Delegation over-reach.** A §3.2 delegation authorizes server keys to sign for
  a publisher; a compromised server key inside an unexpired delegation can still
  mint cards. `validUntil` bounds the window and delegations SHOULD be
  short-lived; revocation reuses the RFC-0001 mechanism on the publisher key.
- **No safety claim.** A verified publisher is an *authenticity* fact, never a
  safety one. Glyph documentation MUST NOT imply that a known publisher is a safe
  one.

## 7. Backwards compatibility

Fully additive. Cards without a publisher binding, consumers with
`requirePublisher: 'none'` (the default), and every existing signature, registry,
keyless, and attestation path are untouched. The per-card mode reuses the
`attestation` envelope, so there is no card-schema change and no wire-version
bump; an unrecognised `publisher-identity-v1` type falls back to today's
behavior (an unverified `provider` string), exactly as any unknown attestation
type does.

## 8. Open questions (to resolve before implementation)

1. **Default distribution of delegations.** Inside an RFC-0003 registry document,
   a publisher-served endpoint, or both. Leaning "both, consumer's choice",
   consistent with RFC-0003's no-central-authority stance.
2. **Publisher key discovery.** How a consumer first learns a publisher key for a
   name (TOFU on first card, a curated registry, DNS-based discovery). Likely
   reuses the same layering as server-key trust rather than inventing a new one.
3. **Adapter behavior.** Whether `@glyphp/adapter-openapi` / `adapter-mcp` should
   emit an *unsigned* publisher placeholder (clearly marking publisher ≠ signer)
   until upstream APIs can actually sign — making the gap visible even before
   publishers adopt keys.
4. **Conformance.** Whether a `production` profile should require a verified
   publisher for `danger` tools, mirroring the same open question in RFC-0008 §8.
