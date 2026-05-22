# Glyph Protocol — Trust model

Status: draft, tracks the current implementation (v0.1).

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
   record of `{callId, glyphId, inputHash, outputHash, riskTier, latencyMs,
   timestamp, provider}` signed by the same server key. `verifyReceipt()`
   verifies it. The receipt rides back in the `SealedEnvelope` and is also
   emitted to the server's `onCall` audit hook.

## What is NOT verified (and why it matters)

- **Trust roots.** A card's `publicKey` proves the card was signed by *that*
  key — not that the key belongs to a provider you trust. Pinning known
  provider keys / a key registry is future work.
- **Key rotation and revocation.** There is no mechanism to rotate or revoke a
  server key yet. A compromised key cannot be invalidated.
- **Executor integrity.** The protocol does not attest what the handler
  actually ran. Output schema validation catches shape violations, not intent.

## Threat posture

Glyph as of v0.1 gives you **tamper-evidence and provenance within one
server's keyspace**: you can detect a modified card or a forged receipt, and
prove which server produced a result. It does **not** yet give you a
cross-organization PKI. Treat `provider` as a claim until trust roots exist.

## License

This specification is licensed under the Apache License, Version 2.0. Anyone
may build independent implementations of the Glyph Protocol under those terms,
including its grant of patent rights. See [`LICENSE`](../LICENSE).
