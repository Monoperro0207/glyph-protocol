# RFC-0003: Public providers registry

- **Status:** Implemented (V1) — `GlyphClient.discoverProviders()` + `verifyProvidersRegistry()`
- **Targets:** Glyph Protocol 1.0
- **Author:** Patrick Espino
- **Created:** 2026-05-24

## 1. Motivation

The protocol gives a consumer everything they need to **verify** a server
they already know: handshake, key registry, signed cards, pin store,
update manifests. It does not yet give them a way to **discover** servers
they don't know about, or to learn that a server they used six months ago
has been revoked, taken down, or marked compromised by other operators.

RFC-0003 specifies a tiny, distribution-friendly format for that: a
single signed JSON document that any operator can host, fork, or mirror,
listing the Glyph providers a community endorses. It deliberately does
**not** specify a central server — the registry is a flat file at a URL.

## 2. Non-goals

- **A global namespace.** Provider identities remain `(endpoint, publicKey)`
  pairs. The registry is a *directory*, not a name authority.
- **Trust transfer.** Inclusion in a registry is a recommendation by
  whoever signed the registry, not a statement of correctness.
- **Discovery of glyphs inside a provider.** That is what handshake +
  lexicon already do per-provider.
- **Centralised revocation.** A revoked entry is one revocation channel;
  the in-protocol key registry (RFC-0001) is another and remains
  authoritative for the server's own keys.

## 3. Wire format

A registry document is a JSON object at any URL the consumer trusts:

```json
{
  "registryVersion": "1.0",
  "registryId": "community.glyph-protocol.dev",
  "issuedAt": "2026-05-24T19:00:00.000Z",
  "ttlSeconds": 86400,
  "providers": [
    {
      "name": "billing.example",
      "endpoint": "https://billing.example.com/glyph",
      "publicKey": "f18c992289a1b940bb6aac740ca9b90452a45427c831cc4fce5d3d1a5b4d3100",
      "intent": "Internal billing operations (read-only and confirmation-gated)",
      "conformanceBadge": "https://billing.example.com/.well-known/glyph-conformance.json",
      "lastVerifiedAt": "2026-05-22T12:00:00.000Z",
      "tags": ["finance", "internal"],
      "status": "active"
    },
    {
      "name": "legacy-tools.example",
      "endpoint": "https://legacy-tools.example.com/glyph",
      "publicKey": "...",
      "status": "revoked",
      "revokedAt": "2026-04-01T00:00:00.000Z",
      "revocationReason": "Provider abandoned, keypair lost"
    }
  ],
  "signedBy": {
    "name": "Glyph community moderators",
    "publicKey": "...",
    "fingerprint": "..."
  },
  "signature": "..."
}
```

- `registryVersion: "1.0"` — schema version (this document).
- `registryId` — opaque identifier of who issued the registry.
- `ttlSeconds` — how long the client may cache before re-fetching.
- Each provider entry carries `(endpoint, publicKey)`, the only fields the
  consumer needs to pin and verify against the provider's `GET /keys`.
- `status` is `active` or `revoked`; revoked entries MUST carry `revokedAt`
  and SHOULD carry `revocationReason`.
- `conformanceBadge` is the URL of the shields.io-style endpoint JSON
  produced by `pnpm conformance:badge` (Phase A). A consumer can render it
  inline next to the entry.
- `signature` is an ed25519 signature over the canonical hash of every
  other field (same `canonicalize()` rules as `GlyphCard`).

The JSON Schema is at [`spec/schemas/registry-v1.json`](../schemas/registry-v1.json).

## 4. Client semantics (future implementation)

This RFC reserves the future TypeScript API:

```ts
const registry = await client.discoverProviders('https://registry.example/glyph.json', {
  trustRoot: '<expected-signer-public-key>',
})
// registry.providers — typed entries, signature already verified
```

The signature MUST be checked against a `trustRoot` the consumer pinned
out of band (via the application's config). The protocol does not specify
how that root is delivered — it is the same model as `KeyRegistry` for a
single provider, applied to the directory.

The discovery call MUST NOT auto-approve any glyph. Approval still
requires the consumer's pin store and the existing `diffCards` flow on
the first `getCard` per provider.

## 5. Distribution model

The reference registry lives at `https://github.com/Monoperro0207/glyph-registry`
(public, separate repo from `glyph-protocol`). Submissions are pull
requests against `registry.json`; merging requires:

- A reproducible build of the signed registry file from the merged JSON.
- An automated re-fetch of every listed `conformanceBadge` showing
  `passing`.
- Verification that `endpoint`/`publicKey` round-trips against the
  provider's `GET /keys`.

A consumer who does not trust the reference registry may fork it; the
spec says nothing that requires a single instance.

## 6. Backwards compatibility

Additive: nothing about RFC-0003 changes the wire protocol or the existing
client API. A consumer that ignores registries continues to work
identically.

## 7. Open questions

- **Transparency log.** Should registry updates anchor to a sigstore-style
  Rekor log so historical state is auditable? Likely yes for v1.1.
- **Granularity.** Should a registry list specific glyph cards (by id), or
  only providers? Current draft: only providers, because card-level pinning
  is already the consumer's job.
- **Multi-signer.** Should a registry accept `signature[]` for n-of-m
  community signing? Out of scope for v1.0; a single signer keeps the
  verification path identical to existing receipts/manifests.
