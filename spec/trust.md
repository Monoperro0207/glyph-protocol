# Glyph Protocol — Trust model

Status: draft, tracks the current implementation (v0.2).

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
- **Key rotation and revocation.** There is no mechanism to rotate or revoke a
  server *key* yet. A compromised key cannot be invalidated. (A consumer can
  revoke a *tool* via `@glyphp/client.revokeTool()` — that is the consumer
  distrusting a specific tool, not the invalidation of a server key.)
- **Executor integrity.** A signed card commits to the tool's *declared
  contract* — never to the *handler implementation* behind it. A provider that
  keeps a card byte-identical and silently changes what the handler does
  produces **the same `id` and the same `signature`**: card pinning,
  `diffCards()`, and update manifests are all blind to it. Output schema
  validation catches shape violations, not intent. Closing this requires
  *execution attestation* — a signed build digest, source commit, or container
  digest — and cooperation from build systems and runtimes. It is the
  honest, structural limit of the protocol; see
  [`update-governance.md §8`](update-governance.md).

## Threat posture

Glyph as of v0.2 gives you **tamper-evidence and provenance within one
server's keyspace**: you can detect a modified card or a forged receipt, and
prove which server produced a result. It does **not** yet give you a
cross-organization PKI. Treat `provider` as a claim until trust roots exist.

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
