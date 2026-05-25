# Glyph Protocol — Trust model

Status: stable, tracks the current implementation (v1.0).

## Identities

A glyph passes through up to three distinct parties:

| Role | Who | In the protocol today |
|---|---|---|
| **Publisher** | Whoever authored the tool's behavior | `GlyphCard.provider` (a string) |
| **Server** | The Glyph server that hosts and signs the card | `GlyphCard.publicKey` / `signature` |
| **Executor** | Whatever the handler ultimately calls (a REST API, an MCP server, local code) | not modeled separately |

For glyphs created with `defineGlyph`, publisher = server. For adapted glyphs
(`@glyphp/adapter-openapi`, `@glyphp/adapter-mcp`) the publisher is the upstream
API/MCP server named in `provider`, while the Glyph server is the signer — the
two genuinely differ, and a future version should make that cryptographically
explicit. Today they are only distinguishable by inspection.

## What is signed

1. **Glyph cards.** On `register()`, the server signs the card's content-
   addressed `id` with its ed25519 private key and embeds `publicKey` +
   `signature`. `verifyGlyph()` checks both that the content still hashes to
   the `id` and that the signature verifies.
2. **Call receipts.** Every successful call produces a `CallReceipt` — a
   record of `{callId, glyphId, inputHash, outputHash, inspectionHash,
   riskTier, latencyMs, timestamp, provider}` signed by the same server key.
   `verifyReceipt()` verifies it. The receipt rides back in the
   `SealedEnvelope` and is also emitted to the server's `onCall` audit hook.
3. **Update manifests.** When a provider chooses to publish one, an
   `UpdateManifest` — committing `previousCardId → newCardId` with a reason and
   a security-impact claim — is signed by the same server key. `verifyManifest()`
   verifies it. A consumer MUST also check that the manifest's
   `serverPublicKey` matches the *pinned* key (see
   [`update-governance.md §7.2`](update-governance.md)).

## What is NOT verified (and why it matters)

- **Trust roots.** A card's `publicKey` proves the card was signed by *that*
  key — not that the key belongs to a provider you trust. `@glyphp/client` can
  pin an approved `(id, publicKey)` pair per tool and refuse a tool that no
  longer matches its pin (see [`update-governance.md`](update-governance.md)),
  which turns "internally consistent" into "the exact card I approved". A
  cross-organization key registry — discovering and trusting keys you have
  never seen — is still future work.
- **Key rotation and revocation.** Rotation is supported via the key registry
  (RFC-0001): a server publishes an ordered chain of `KeyEntry` records. To
  rotate, add a new entry signed by the current active key and set `validUntil`
  on the old one. Consumers verify the chain end-to-end. To revoke a
  compromised key, set `revokedAt` on its entry — `resolveKey()` will report
  `status: 'revoked'`. See `packages/core/src/key-registry.ts` and
  `packages/core/test/key-registry.test.ts` for the implementation.

### Key lifecycle (operations runbook)

1. **Generation.** `generateKeyPair()` from `@glyphp/core` produces a fresh
   ed25519 key pair. Store the private key in a secrets manager (env var,
   vault, KMS) — never commit it.

2. **Deployment.** Set `GLYPH_PRIVATE_KEY` in the server environment. The
   `GlyphServer` constructor accepts `keyPair: { publicKey, privateKey }`.

3. **Rotation.** To rotate without downtime:
   - Generate a new key pair.
   - Build an updated `KeyRegistry` with the new key's entry signed by the
     current active key, and `validUntil` set on the old entry.
   - Deploy the new registry via `registerKeyRegistry()`.
   - Consumers verifying the chain will trust the new key automatically.
   - After the `validUntil` window, remove the old key from the server.

4. **Revocation (compromise).** If a key is compromised:
   - Generate a new key pair immediately.
   - Build a `KeyRegistry` with a new entry and the compromised key's entry
     marked with `revokedAt`.
   - Deploy immediately. Consumers calling `resolveKey()` on the compromised
     key will receive `status: 'revoked'` and must re-fetch the registry.
   - Rotate any secrets the compromised key had access to.

5. **Recovery (lost key).** If the private key is lost without compromise:
   - There is no cryptographic recovery — ed25519 keys cannot be derived from
     the public key.
   - **Prevention**: back up the private key to an offline medium (hardware
     security key, paper backup in a safe) at generation time.
   - **If lost**: generate a new key pair and follow the rotation procedure.
     Existing signatures remain valid — only new signatures use the new key.
   - Treat a lost key as potentially compromised until you can confirm the
     backup was never accessed.
- **Executor integrity.** A signed card commits to the tool's *declared
  contract* — never to the *handler implementation* behind it. A provider that
  keeps a card byte-identical and silently changes what the handler does
  produces **the same `id` and the same `signature`**: card pinning,
  `diffCards()`, and update manifests are all blind to it. Output schema
  validation catches shape violations, not intent.

  Closing this requires *execution attestation* — a signed build digest,
  source commit, container digest, or formal provenance produced by an
  authority **outside the provider's process**. A card may carry an optional
  `attestation` envelope (`{type, payload}`) that the SDK commits to via the
  card id; `verifyAttestation()` checks the envelope is well-formed, but
  verifying the payload requires a trust root the consumer already trusts
  (Sigstore registry, GitHub OIDC, SLSA verifier, etc.). The SDK can never
  attest to its own host: a program cannot certify its own integrity, only
  an external authority can. See [`update-governance.md §8`](update-governance.md).

## Threat posture

Glyph as of v1.0 gives you **tamper-evidence and provenance within one
server's keyspace** — with key rotation and revocation (RFC-0001). You can
detect a modified card or a forged receipt, prove which server produced a
result, and invalidate a compromised key. It does **not** yet give you a
cross-organization PKI or multi-signer trust. Treat `provider` as a claim
until trust roots and multi-key verification exist.

## Inert data

Glyph's design treats tool output as data, never instructions. The server
sanitizes every payload (see [`security.md`](security.md)) and the
`SealedEnvelope` carries a signed `inspection` report of what was removed.

This is a real, deterministic defense against *invisible* injection — Unicode
tag-block characters, zero-width characters, and bidirectional overrides
cannot ride along inside a result. It is **not** full prompt-injection
immunity: a payload can still contain visible text that reads as an
instruction, and a model is free to obey it. Structurally separating the data
channel from the control channel so that a *host enforces* the distinction
requires cooperation from the model runtime, and is out of scope for the SDK
alone.

## License

This specification is licensed under the Apache License, Version 2.0. Anyone
may build independent implementations of the Glyph Protocol under those terms,
including its grant of patent rights. See [`LICENSE`](../LICENSE).
