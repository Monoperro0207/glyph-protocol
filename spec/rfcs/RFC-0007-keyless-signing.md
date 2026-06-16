# RFC-0007: Keyless Signing (OIDC-bound provenance)

- **Status:** Draft (spec only, no implementation in this RFC)
- **Targets:** Glyph Protocol 1.x (additive, backwards-compatible)
- **Author:** Glyph Protocol
- **Created:** 2026-05-29
- **Updated:** 2026-06-12 — `subjectDigest` redefined over the
  **attestation-exclusive** canonical id (§3.1.1). The original definition
  (`sha256(card.id)`) was unsatisfiable: the bundle lives inside
  `card.attestation`, which itself enters `card.id`, so no bundle could
  commit to the id that contains it.

## 1. Motivation

Glyph's whole thesis is "verify before you trust." But verification only
matters if people actually publish verifiable glyphs — and today publishing a
*signed* glyph means the author must generate, store, and guard an ed25519
private key (`glyph keys init`, RFC-0001). That is the same friction that
killed PGP for the long tail of developers: key custody is a chore, so most
artifacts ship unsigned and the security guarantee evaporates in practice.

The fix is well understood from Sigstore/cosign: **keyless signing**. Instead
of a long-lived key the author holds, the signature is bound to an *ephemeral*
key whose only proof of provenance is an OIDC identity token issued at build
time (GitHub Actions, GitLab CI, Google, etc.). The author manages no secret;
the CI identity *is* the identity. A transparency log makes the binding
auditable after the ephemeral key is discarded.

This RFC specifies how a keyless provenance attestation rides on the **existing
`card.attestation` hook** (RFC: see `CardAttestation` in `@glyphp/types`) so
that:

- a publisher can sign a glyph **without holding any private key**, and
- a consumer can verify "this card was produced by `repo:acme/tools` on
  `refs/tags/v1.2.0`" with **zero local configuration** in the common case.

It is deliberately **additive**: the ed25519 `card.signature` + Key Registry
(RFC-0001) remain fully valid and unchanged. Keyless is a second, optional
provenance layer for authors who would rather not run a key at all.

This RFC does **not** implement anything. It fixes the wire shape, the trust
model, and the verification contract so the implementation PRs (TOFU,
zero-config verify, registry hardening) can proceed against a stable target.

## 2. Non-goals

- Replacing ed25519 card signatures or the Key Registry. Both stay.
- Shipping a Glyph-operated transparency log or CA. Keyless reuses an
  **existing** trust root (e.g. the Sigstore public-good instance) that the
  consumer already trusts; Glyph does not become a PKI.
- Verifying the *behavior* of a tool. Keyless attests **provenance** ("who
  built this card, from where"), not safety. The card's cost/risk fields and
  the consumer's pin gate remain the behavioral controls.

## 3. Wire format

A keyless-signed glyph carries a `card.attestation` envelope with a new
`type`:

```json
{
  "attestation": {
    "type": "glyph-keyless-v1",
    "payload": "<base64 of the provenance bundle, see §3.1>",
    "reference": "<optional URL to the transparency-log entry>"
  }
}
```

`type`, `payload`, and `reference` are the three fields `CardAttestation`
already defines — no schema change to the card. `glyph-keyless-v1` is the only
new value this RFC introduces.

### 3.1 The provenance bundle

`payload` is the base64 encoding of a canonical-JSON bundle:

```json
{
  "bundleVersion": "glyph-keyless-v1",
  "subjectDigest": "<sha-256 of the card's attestation-exclusive glyph id, hex — see §3.1.1>",
  "issuer": "https://token.actions.githubusercontent.com",
  "identity": "repo:acme/tools:ref:refs/tags/v1.2.0",
  "signingCertificate": "<PEM of the ephemeral cert issued by the CA>",
  "logEntry": {
    "logIndex": 1234567,
    "logId": "<base64 log id>",
    "inclusionProof": "<opaque, log-specific>"
  }
}
```

- **`subjectDigest`** binds the bundle to *this* card's content: it is the
  SHA-256 of the card's **attestation-exclusive** canonical id (§3.1.1). A
  bundle lifted onto a card with different content fails this check, so
  keyless provenance cannot be replayed.
- **`identity`** is the human-meaningful provenance claim the consumer matches
  policy against (see §4.2).
- **`signingCertificate`** + **`logEntry`** are the Sigstore-style proof that
  the ephemeral key was bound to `identity` by `issuer` and recorded in a log.
  Their internal format is the upstream verifier's concern; Glyph treats them
  as opaque inputs to that verifier.

### 3.1.1 The subject digest and the id fixed point

The card's content-addressed `id` (RFC: `computeGlyphId`) covers the
`attestation` field — an attested card and its unattested twin are different
tools, and tampering with the attestation must flip the id. But the keyless
bundle *is* the attestation payload: a bundle that committed to
`sha256(card.id)` would have to contain a digest of the very bytes that
contain it, and no sha256 fixed point exists. The original draft of this RFC
required exactly that, which made a card that passes both `verifyGlyph()` and
keyless verification unconstructible.

The resolution mirrors the ed25519 path, which already solves the same
problem: the canonical id *excludes* `signature`/`publicKey` precisely so the
signature can commit to the id without containing itself. Keyless excludes
the slot that carries *its* proof:

> **`subjectDigest` = SHA-256 (hex) of the card's canonical id computed with
> the `attestation` slot absent** (the *attestation-exclusive id*). All other
> canonical fields are covered. For a card without an attestation the
> attestation-exclusive id and `card.id` coincide, so the digest degenerates
> to `sha256(card.id)`.

The final `card.id` still includes the attestation, so the published card
remains tamper-evident end to end: the bundle commits to the behavioral
content, and the id commits to the content *plus* the bundle.

Producer flow (two steps, no fixed point needed):

1. Assemble the card content, compute the attestation-exclusive id, and
   keyless-sign its SHA-256 → the bundle (§3.1).
2. Attach the `attestation` envelope, then compute the final `card.id` (which
   now covers the attestation). If the card is also key-signed (§3.2), the
   ed25519 signature is made over this final id, as always.

SDK helpers: `keylessSubjectDigest()` in `@glyphp/core`,
`compute_keyless_subject_digest()` in `glyph-protocol` (Python).

### 3.2 Interaction with `card.signature`

Three valid shapes, all already expressible:

| Card has ed25519 `signature` | Card has `glyph-keyless-v1` attestation | Meaning |
|---|---|---|
| yes | no | classic signed glyph (RFC-0001) — unchanged |
| yes | yes | belt-and-suspenders: key-signed *and* keyless provenance |
| no | yes | **keyless-only**: no private key was ever held |

A keyless-only card has no `publicKey`/`signature`. `verifyGlyph()` already
returns `false` for such a card (no signature to verify); keyless verification
(§4) is what establishes its provenance instead. The content integrity check
(`computeGlyphId(card) === card.id`) still applies in both worlds — and is
satisfiable in both, because the bundle commits to the attestation-exclusive
id (§3.1.1) while `card.id` is computed *after* the attestation is attached.
In the belt-and-suspenders shape the ed25519 signature covers the final id
(content **and** attestation), and the bundle covers the content.

## 4. Trust model & verification contract

### 4.1 Layered, lowest-friction-first

A consumer resolves provenance through layers, stopping at the first that
satisfies its policy:

1. **Pin (TOFU or explicit).** If the consumer already pinned this tool, the
   pin is authority — no network, no config. (Trust-on-first-use is specified
   in the TOFU implementation PR; keyless is what gets pinned for a keyless-only
   card: the `identity`, not a `publicKey`.)
2. **Keyless attestation.** Verify the bundle (§4.2) against a trust root the
   consumer already accepts. Default config: the Sigstore public-good root,
   which requires **no per-project setup**.
3. **Key Registry (RFC-0001) / Public registry (RFC-0003).** For key-signed
   cards, the existing path is unchanged.

The design intent: the *common* case (a CI-published, keyless glyph consumed by
an agent with default trust roots) verifies with **zero configuration**, while
the paranoid case can pin identities, restrict issuers, or run its own root.

### 4.2 What a verifier MUST check

A `glyph-keyless-v1` verifier (an `AttestationVerifier`, reusing the existing
interface) MUST, in order, and fail closed on any miss:

1. **Subject binding** — `bundle.subjectDigest` equals the SHA-256 of the
   card's attestation-exclusive canonical id (§3.1.1), **recomputed from the
   received card's content**. A verifier MUST NOT compare against
   `sha256(card.id)`: for an attested card the final id covers the
   attestation and never matches, and trusting the self-declared `id` field
   would not bind content anyway. (Integrity of `card.id` itself is the §3.2
   content-integrity check, which is independent of this one.)
2. **Bundle validity** — the `signingCertificate` chains to a trusted root and
   the `logEntry` inclusion proof verifies against a trusted log. (Delegated to
   the upstream Sigstore-style verifier; Glyph does not reimplement it.)
3. **Identity policy** — `bundle.identity` and `bundle.issuer` satisfy the
   consumer's policy. Default policy when none is configured: accept any
   identity from a trusted issuer (provenance is *recorded and auditable*, even
   if unrestricted). A stricter policy pins an allow-list of
   `issuer`+`identity` patterns. An allow-list entry matches **exactly, or as
   a prefix that ends at a segment boundary** (`:` or `/`): `repo:acme/tools`
   matches `repo:acme/tools:ref:refs/heads/main` but MUST NOT match
   `repo:acme/tools-evil` — a bare prefix match would silently widen the
   authorization.

The result maps onto the existing `AttestationResult`: `valid` for checks 1–2,
`trusted` reflecting check 3 (`trusted: false` = "well-formed and logged, but
the identity is outside your policy"). This mirrors how `verifyAttestation()`
already separates *well-formed* from *recognised/trusted*.

### 4.3 Relationship to the autonomous layer (FASE 1)

`AutoPromotionPolicy.requireAttestation` (PR 1.3) already gates auto-promotion
on a valid attestation. A `glyph-keyless-v1` attestation satisfies that gate
exactly like a Sigstore/SLSA one — so an operator can express "auto-promote
breaking updates **only** when they carry verifiable keyless provenance from
`repo:acme/tools`." Keyless and the autonomous layer compose without new API.

## 5. CLI & API surface (specified, implemented later)

- `glyph verify <card>` — when the card carries a `glyph-keyless-v1`
  attestation, verifies it through the layered model (§4.1) with default trust
  roots and **no required flags**. `--issuer`/`--identity` narrow the policy;
  `--no-keyless` opts out.
- A `KeylessVerifier implements AttestationVerifier` registered in
  `@glyphp/core`, pluggable like `SigstoreVerifier`/`SlsaVerifier` so consumers
  can swap the trust root.
- No change to `signGlyph`, `verifyGlyph`, `computeGlyphId`, the Key Registry,
  or the wire protocol version. Card schema is unchanged (reuses `attestation`).

## 6. Security considerations

- **Replay across cards** — prevented by `subjectDigest` binding (§4.2.1):
  the digest covers every canonical field except the `attestation` slot
  itself, so a bundle only verifies on a card with byte-identical canonical
  content. Replaying a bundle onto the *same* content is by definition not a
  replay — the provenance claim is about the content, not the envelope.
- **Issuer spoofing** — the bundle's certificate must chain to a trusted root;
  an attacker cannot mint a `token.actions.githubusercontent.com` identity
  without GitHub's CA. Glyph delegates this to the upstream verifier rather
  than trusting the `issuer`/`identity` strings on their face.
- **Downgrade** — a card stripping its attestation becomes "unattested," which
  fails any policy that required attestation (`requireAttestation`, RFC-0001
  consumers, PR 1.3). Keyless never *weakens* an existing requirement.
- **Log availability** — verification needs a transparency-log check. Offline
  or air-gapped consumers fall back to pinned identities (§4.1 layer 1) or to
  classic key-signed cards; keyless is opt-in precisely so these consumers are
  never forced onto it.
- **Not a behavioral guarantee** — keyless proves origin, not safety. The pin
  gate, diff/severity classification, and confirmation flow remain the controls
  over what a verified-origin tool is allowed to *do*.

## 7. Backwards compatibility

Fully additive. Existing key-signed cards, the Key Registry, receipts, and the
wire protocol are untouched. A consumer with no keyless verifier registered
treats a `glyph-keyless-v1` attestation as an unrecognised type
(`verifyAttestation().recognized === false`) — exactly today's behavior for any
unknown attestation format — and falls back to the ed25519/registry path.

## 8. Open questions (to resolve before implementation)

1. Which upstream verifier library to depend on, and whether it is a hard
   dependency of `@glyphp/core` or an optional peer (keeping core dependency-
   light argues for a peer + injected verifier).
2. Bundle format: adopt the Sigstore protobuf bundle verbatim vs. the trimmed
   JSON shape in §3.1. Verbatim maximizes interop; the trimmed shape keeps the
   card payload small.
3. Default identity policy: accept-any-trusted-issuer (max adoption, provenance
   still auditable) vs. require-explicit-allow-list (max strictness). Leaning
   accept-any with a one-line opt-in to strict, consistent with the friction
   thesis.
