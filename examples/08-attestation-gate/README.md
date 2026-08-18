# 08 · Execution-attestation gate

A signed glyph card proves **"this is the contract the publisher declared."**
It does **not** prove **"this is the code that runs behind it."** A provider can
keep a card byte-identical and silently change what the handler does — same `id`,
same signature (see [`spec/trust.md`](../../spec/trust.md) "Executor integrity"
and [`RFC-0008`](../../spec/rfcs/RFC-0008-execution-attestation.md)).

`requireAttestation` is the consumer-side gate that demands **external evidence**
— produced outside the provider's process — before a `danger` tool is allowed to
run. This example shows exactly what that gate does today, and — just as
importantly — **exactly where it stops.** The same function backs the demo and
the test, so **what you see narrated is exactly what the test asserts.**

```bash
pnpm --filter 08-attestation-gate demo   # narrated walkthrough
pnpm --filter 08-attestation-gate test   # the assertions behind it
```

## The gate

```
 client.call("deploy-release")  (riskTier: danger)
            │
            ▼
   requireAttestation policy?
     ├── 'none'  ──────────────────────────────►  runs (attestation opt-in)
     └── 'danger' / 'all'
            │
            ▼
   card carries an attestation?
     ├── no  ───────────────────────────────────►  REFUSED (no attestation)
     └── yes
            │
            ▼
   a registered verifier returns valid && trusted ≠ false ?
     ├── container-digest matching the pinned digest  ─►  runs
     ├── container-digest, no pin configured  ───────►  REFUSED (trusted: false)
     ├── container-digest for another artifact  ─────►  REFUSED (binding failed)
     ├── malformed digest  ──────────────────────────►  REFUSED (rejected)
     └── SLSA/Sigstore structure-only                ─►  REFUSED (trusted: false)
         (valid shape, but no cryptographic chain — RFC-0008 §4.1 step 3)
```

## What it demonstrates

1. **Opt-in** — with `requireAttestation: 'none'` (the default) an unattested
   `danger` tool runs exactly as before. The gate is additive.
2. **Gate closed** — under `requireAttestation: 'danger'`, an unattested
   `danger` tool is refused with `GlyphAttestationError` **before its handler
   runs**.
3. **Gate open** — a card whose `container-digest` attestation
   (`{ "digest": "sha256:…" }`) matches the digest the consumer pinned via
   `new DigestVerifier({ expectedDigest })` passes and executes.
4. **Unbound evidence** — the *same card*, checked by a `DigestVerifier` with no
   `expectedDigest`, is **refused**. Without a pin the verifier validates format
   only and reports `trusted: false`: an unbound digest is a provider self-claim,
   not evidence about this deployment
   ([RFC-0008 §3.2](../../spec/rfcs/RFC-0008-execution-attestation.md)).
5. **Lifted evidence** — a well-formed digest belonging to a *different*
   artifact fails the subject binding. This is the attack §3.2 exists to stop:
   format validation alone would wave it through.
6. **Malformed evidence** — a broken digest is rejected by the verifier.
7. **The honest limit** — a *structurally* valid SLSA provenance is `valid` but
   `trusted: false` (the shipped `SlsaVerifier`/`SigstoreVerifier` validate
   shape, not the cryptographic chain). `ensureAttested()` treats
   valid-but-not-trusted as **insufficient**, so the gate stays **closed**. To
   close that gap, use `SigstoreBundleVerifier` from
   [`@glyphp/attestation-sigstore`](../../packages/attestation-sigstore), which
   performs the real DSSE + certificate-chain check
   ([RFC-0008 §4.1 step 3](../../spec/rfcs/RFC-0008-execution-attestation.md)).
8. **Tier-scoped** — under the same `danger` policy, a `safe` tool needs no
   attestation and runs untouched. The policy gates by risk tier.
9. **Downgrade-resistant** — the attestation is part of the card's canonical
   content, so it is bound to the `id`. Stripping it yields a **different `id`**:
   an attacker cannot quietly downgrade a pinned, attested card to an unattested
   one without breaking the pin.

## Why this matters

The value here is not a claim that attestation makes execution "safe" — it does
not, and the docs deliberately never say so. The value is an **honest, gated
trust boundary**: a `danger` tool runs only with evidence the consumer's policy
accepts, and the one verifier that today returns a real (non-structural) verdict
is the only one that opens the gate. Everything stronger — a full Sigstore/SLSA
chain bound to the serving artifact's digest — is specified in RFC-0008 and lands
as the verifiers graduate from structure-only to chain-verifying.
