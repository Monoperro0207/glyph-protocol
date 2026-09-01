# RFC-0008: Execution Attestation (binding the card to the code that runs)

- **Status:** Implemented (V1) — `SigstoreBundleVerifier` in
  `@glyphp/attestation-sigstore` (chain verification, §4.1 step 3) and the
  subject-digest binding (§3.2) in both it and `DigestVerifier`
- **Targets:** Glyph Protocol 1.x (additive, backwards-compatible)
- **Author:** Glyph Protocol
- **Created:** 2026-05-31
- **Updated:** 2026-08-18 — implemented. `DigestVerifier` now reports
  `trusted: false` unless an `expectedDigest` pin is configured: an unbound
  digest is a provider self-claim and must not open the `requireAttestation`
  gate (§3.2, §4.1 step 4). This is a breaking change to `@glyphp/core`.

## 1. Motivation

A signed glyph card commits to a tool's *declared contract* — its id, schema,
intent, cost, and risk. It does **not** commit to the *handler implementation*
behind that contract. A provider can keep a card byte-identical and silently
change what the handler does: the `id` and `signature` are unchanged, so card
pinning, `diffCards()`, and update manifests are all blind to it. This is
stated plainly in [`../trust.md`](../trust.md) ("Executor integrity") and
[`../update-governance.md §8`](../update-governance.md) ("What this does not
solve"). It is the deepest trust gap in the protocol.

Closing it requires **execution attestation**: evidence — produced by an
authority *outside the provider's process* — of which code actually runs behind
the card. The building blocks already exist:

- the optional [`CardAttestation`](../../packages/types/src/types.ts) envelope
  (`{ type, payload, reference }`), which enters the card's canonical content so
  it is bound to the `id` and treated as a breaking change by `diffCards()`;
- a pluggable `AttestationVerifier` interface + `AttestationVerifierRegistry`,
  with `SigstoreVerifier`, `SlsaVerifier`
  ([`@glyphp/client`](../../packages/client/src/attestation.ts)) and
  `DigestVerifier` ([`@glyphp/core`](../../packages/core/src/attestation.ts));
- a consumer-side gate: `GlyphClient.requireAttestation: 'none' | 'danger' |
  'all'`, enforced by `ensureAttested()` before `call()`.

What is missing is a **specification**: today the `type` values are only
"conventional values" in a doc comment, the verifiers validate envelope
*structure* but not the cryptographic chain, and nothing pins the attested
*subject digest* to the artifact actually serving the handler. This RFC fixes
the wire conventions, the **digest-binding rule**, and the verification
contract so the implementation can proceed against a stable target — exactly as
[RFC-0007](RFC-0007-keyless-signing.md) did for keyless provenance.

This RFC implements nothing.

## 2. Non-goals

- **Closing the gap completely.** Execution attestation *narrows* the gap to a
  hardware-rooted proof; it does not eliminate it. The residue is irreducible
  and shared by all attestation systems (Sigstore/SLSA/TEE alike) — see §6. The
  RFC's job is to make Glyph reach the practical limit and to state the residue
  honestly, not to claim it is closed.
- **The SDK producing attestations.** The SDK can only *verify*. A program
  cannot certify its own host integrity; only an external authority (CI, a
  build service, a TEE) can. This is already documented on `CardAttestation`.
- **Forcing attestation by default.** It stays opt-in via `requireAttestation`.
  Cards without attestation behave exactly as today.
- **Replacing ed25519 signatures, keyless (RFC-0007), or the Key Registry.**
  Attestation is an *additional, orthogonal* layer answering "what code runs",
  not "who signed the card".

## 3. Wire format

Execution attestation reuses the existing `CardAttestation` envelope unchanged:

```json
{
  "attestation": {
    "type": "<format identifier, see §3.1>",
    "payload": "<base64/hex of the format-specific evidence>",
    "reference": "<optional URL to an external transparency log / store>"
  }
}
```

No card-schema change. As today, the envelope is part of the canonical content,
so any change to it yields a new `id` and a `breaking` diff.

### 3.1 Registered `type` values

This RFC promotes the previously-conventional values to a registered set, each
with a defined verifier contract (§4):

| `type` | Evidence in `payload` | Verifier |
|---|---|---|
| `slsa-provenance` | SLSA Provenance v1.0 predicate (in-toto statement) | `SigstoreBundleVerifier` |
| `sigstore-bundle` | Sigstore bundle v0.3 (DSSE + Rekor entry) | `SigstoreBundleVerifier` |
| `container-digest` | `{ "digest": "sha256:<64 hex>" }` of the serving image | `DigestVerifier` |
| `in-toto` | generic in-toto statement | (consumer-supplied) |
| `glyph-keyless-v1` | provenance bundle from [RFC-0007](RFC-0007-keyless-signing.md) | `KeylessVerifier` |

A consumer with no verifier registered for a given `type` treats it as
unrecognised and falls back to its non-attestation policy — today's behavior.

**Legacy structure-only aliases.** `@glyphp/client` also ships `SigstoreVerifier`
(type `sigstore`) and `SlsaVerifier` (type `slsa`). They validate envelope
*shape* and return `trusted: false` unconditionally, so they can never satisfy
`requireAttestation` (§4.2) — they are diagnostics, and are deprecated in favour
of `SigstoreBundleVerifier`. They keep their legacy `type` strings deliberately:
`AttestationVerifierRegistry` is keyed by `type`, so reusing the registered names
would let a structure-only verifier silently displace the chain-verifying one.

### 3.2 The subject-digest binding rule (the core of this RFC)

The structural verifiers as shipped answer "is this a well-formed SLSA/Sigstore/
digest envelope?" — not "does it describe *this* deployment?". A bundle lifted
from another artifact would pass structure-only checks. To prevent that, a
conforming verifier MUST enforce a **subject binding**:

- The attestation's **subject digest** (SLSA `subject[0].digest.sha256`, the
  Sigstore message digest, or the `container-digest` value) MUST equal the
  digest of the artifact that serves the handler for this card.
- The **expected** digest is declared out of band and pinned by the consumer
  alongside the `(id, publicKey)` pin: a deployment publishes "card `X` is
  served by image `sha256:…`", and the consumer pins that tuple. An attestation
  whose subject digest does not match the pinned expected digest fails closed.

This is the link that turns "a valid SLSA statement exists somewhere" into "the
code answering this call is the attested code". Without it, attestation proves
provenance of *an* artifact, not of *the serving* artifact.

## 4. Trust model & verification contract

### 4.1 Layered, fail-closed

When `requireAttestation` is not `'none'` and a card's risk tier is in scope
(`'danger'` → only `danger` tools; `'all'` → every tool), `ensureAttested()`
MUST resolve attestation through these layers and fail closed on any miss:

1. **Envelope present & recognised.** The card carries an `attestation` whose
   `type` has a registered verifier. Absent/unrecognised ⇒ refuse the call.
2. **Structure valid.** The verifier parses the payload and validates the
   format (the shipped `valid` check).
3. **Cryptographic chain valid.** The evidence verifies against a trust root the
   consumer already accepts — the Sigstore/Fulcio root, a SLSA builder identity,
   a container registry's signature. *This is the upgrade from structure-only;
   it requires an upstream verifier dependency (§8).*
4. **Subject binding (§3.2).** The attested subject digest matches the consumer's
   pinned expected digest for this card.
5. **Policy.** The provenance claim (builder id, source repo/ref, issuer)
   satisfies the consumer's policy. Default when unset: accept any chain-valid,
   correctly-bound attestation (provenance is recorded and auditable even if the
   identity is unrestricted), mirroring RFC-0007 §4.2.

### 4.2 What `valid` / `trusted` mean

The result maps onto the existing `AttestationResult` (`{ valid, type, trusted?,
error?, details? }`):

- `valid: true` covers checks 2–4 (well-formed, chain-valid, correctly bound).
- `trusted` reflects check 5 (`trusted: false` = "verifiably attested, but the
  provenance is outside your policy").

A tool in scope for `requireAttestation` is releasable only when `valid` **and**
the policy is satisfied. `valid && !trusted` MUST NOT release a `danger` tool.

### 4.3 Relationship to other layers

- **Keyless (RFC-0007)** is a *provenance* attestation about who built the card;
  execution attestation is about *what code runs*. They compose: a card may
  carry both, and `requireAttestation` is satisfied by any in-scope, valid,
  policy-passing attestation.
- **Autonomous layer (RFC-0002 / FASE 1).** `AutoPromotionPolicy.requireAttestation`
  already gates auto-promotion on a valid attestation; this RFC defines what
  "valid" means for execution-attestation types, so the autonomous layer can
  express "auto-promote a `danger` update only when it carries a chain-valid,
  digest-bound SLSA provenance from `builder:acme-ci`".

## 5. CLI & API surface

**Landed.** Verifiers upgraded from structure-only to chain-verifying behind an
injected upstream verifier, keeping `@glyphp/core` dependency-light (the
verifier is a separate opt-in package, same stance as RFC-0007 §8). The §3.2
binding is configured **per verifier** at construction —
`SigstoreBundleVerifier({ expectedSubjectDigest })` and
`DigestVerifier({ expectedDigest })` — which is where the consumer declares
"card `X` is served by artifact `sha256:…`".

**Still open.** `GlyphClient` does not yet carry an explicit *expected-digest*
pin alongside the `(id, publicKey)` pin. That is a distribution question, not a
verification one — see §8 Q2 — and the per-verifier pin already satisfies §3.2
in the meantime. `glyph verify <card> --attestation`, which would report each
layer of §4.1 separately, is likewise not implemented.
- No change to `signGlyph`, `verifyGlyph`, `computeGlyphId`, the wire protocol
  version, or the card schema.

## 6. Security considerations

- **The irreducible residue (state it, do not hide it).** Even a chain-valid,
  digest-bound, TEE-rooted attestation proves *which measured code runs* — never
  that the code's *behavior* matches the card's natural-language intent. That
  semantic gap is a specification/verification problem, not a cryptographic one,
  and no attestation system closes it. Likewise, every chain ultimately roots in
  trusting *some* authority (a CA, a hardware vendor); attestation **moves** the
  trust root, it does not remove it. Glyph documentation MUST NOT claim
  "guaranteed safe execution".
- **Replay across deployments** — prevented by the subject-digest binding (§3.2):
  a valid bundle for a different artifact fails the binding check.
- **Downgrade / stripping** — removing the attestation yields a new `id`
  (it is canonical content) and an "unattested" card, which fails any
  `requireAttestation` policy. Attestation never weakens an existing pin.
- **Structure-only false confidence** — resolved. The chain-verifying path is
  `SigstoreBundleVerifier` (`@glyphp/attestation-sigstore`), the only verifier
  that returns `trusted: true`. The legacy structure-only verifiers (§3.1) are
  hard-wired to `trusted: false`, so a passing structural check can no longer be
  mistaken for a gate-opening verdict — it cannot open the gate at all.
- **Unbound self-claims** — a `container-digest` attestation with no consumer
  pin is a provider assertion about itself, backed by nothing external.
  `DigestVerifier` therefore reports `trusted: false` unless constructed with
  `expectedDigest`. Treating an unbound digest as sufficient would have let any
  well-formed sha256 string open a `danger` gate.

## 7. Backwards compatibility

Fully additive. Cards without an `attestation` envelope, consumers with
`requireAttestation: 'none'` (the default), and every existing signature/registry
path are untouched. The registered `type` table (§3.1) only documents and
constrains values that were already conventional; an unrecognised `type` falls
back to today's behavior. No wire-version bump.

## 8. Open questions

1. **Upstream verifier dependency.** _Resolved._ `@sigstore/verify` performs the
   chain verification: ~940 KB across 4 pure-JS packages (no native bindings),
   capable of fully offline, deterministic DSSE + chain verification with
   injected trust material. It ships as `@glyphp/attestation-sigstore`, a
   separate opt-in package implementing `AttestationVerifier`, so `@glyphp/core`
   and `@glyphp/client` take zero new runtime dependencies.
2. **Expected-digest distribution.** How a deployment publishes "card `X` →
   image `sha256:…`": inside the card (a self-referential digest is circular), a
   side-channel signed by the server key, or the public registry (RFC-0003).
3. **TEE quotes** (`tee-quote-sgx`, `tee-quote-sev-snp`, AWS Nitro) as additional
   registered `type` values — the strongest binding of attested code to running
   code — deferred to a follow-up once the SLSA/Sigstore path lands.
4. **Conformance.** Whether a `production` conformance profile should *require* a
   chain-verifying attestation path for `danger` tools.
