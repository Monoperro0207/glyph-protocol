# RFC-0001: Key Registry, Rotation and Revocation

- **Status:** Draft
- **Targets:** Glyph Protocol 1.0
- **Author:** Patrick Espino
- **Created:** 2026-05-23

## 1. Motivation

Glyph 0.2 binds each server to a single, immutable ed25519 keypair. Three
problems follow from that:

1. **Compromise has no remedy.** If the private key leaks, every previously
   signed card and receipt continues to verify against the leaked public key.
   Clients have no protocol-level way to learn that the key is no longer
   trusted.
2. **There is no continuity of identity across rotations.** A server that
   regenerates its keypair invalidates every previously signed artifact at
   once — even though the operator's intent is to *succeed* the old key, not
   repudiate everything signed by it.
3. **Identity is shipped only inside the card.** A consumer pinning
   `(id, publicKey)` per tool has no place to verify, at protocol level,
   *which keys this server publishes as legitimate right now*.

This RFC introduces a per-server **Key Registry**: a list of public keys with
their validity windows, a chain-of-trust link from each key to the one that
authorised it, and an optional revocation list. It is served from
`GET /keys` and consumed by clients during verification of cards and receipts.

The RFC does NOT introduce external PKI (Sigstore, CT logs, X.509). Those
remain as future, opt-in integrations layered on top of the
`KeyRegistry` interface defined here.

## 2. Wire format

A server publishing a registry exposes:

```
GET /keys
→ 200 KeyRegistry
```

The `KeyRegistry` schema (canonical JSON, JSON Schema 2020-12) is:

```json
{
  "registryVersion": "1.0",
  "serverId": "<opaque identifier of the server>",
  "active": "<fingerprint>",
  "keys": [
    {
      "fingerprint": "<sha-256 of publicKey, hex>",
      "publicKey": "<ed25519 public key, hex>",
      "validFrom": "<RFC 3339 timestamp>",
      "validUntil": "<RFC 3339 timestamp, optional>",
      "revokedAt": "<RFC 3339 timestamp, optional>",
      "revocationReason": "<string, optional>",
      "signedBy": "<fingerprint of the previous key, optional>",
      "signature": "<ed25519 signature, hex, optional>"
    }
  ],
  "issuedAt": "<RFC 3339 timestamp>",
  "ttlSeconds": 3600,
  "signature": "<ed25519 signature of the canonical hash, hex>"
}
```

The registry's outer `signature` is produced by the **currently active** key
over the canonical hash of every other field. Each per-entry `signature` is
produced by the key whose `fingerprint` equals `signedBy` (chain-of-trust).
The genesis entry has no `signedBy`/`signature`.

## 3. Verification

A client receiving a card or receipt signed with public key *K*:

1. Resolves *K* to a registry entry by `fingerprint`.
2. If no entry matches *K* in any consulted registry, treats the signature as
   unverified (legacy behaviour — `verifyGlyph` / `verifyReceipt` still works
   without a registry).
3. If the entry has `revokedAt`, the signature is **rejected** with the new
   error code `KEY_REVOKED` regardless of `validUntil`.
4. If the entry has `validUntil` and the receipt/card timestamp is after
   `validUntil`, the signature is rejected as expired.
5. Each non-genesis entry must verify against the `signedBy` entry's public
   key. A break in the chain rejects every successor.

A client SHOULD cache the registry for `min(ttlSeconds, 1 hour)` and refetch
after that period. A registry whose outer signature does not verify against
its declared active key is rejected entirely.

## 4. Rotation

To rotate from key *A* to key *B*:

1. The server generates *B*.
2. *A*'s private key signs an entry for *B* (`signedBy = fingerprint(A)`).
3. The server publishes a new registry whose `active = fingerprint(B)`,
   `keys` includes both *A* (now with `validUntil = now`) and *B* (with
   `validFrom = now` and `signedBy = fingerprint(A)`), and whose outer
   `signature` is produced by *B*.

Existing cards/receipts signed by *A* before `validUntil` continue to verify.
New cards/receipts are signed by *B*.

## 5. Revocation

To revoke key *K*:

1. The server marks *K*'s entry with `revokedAt = now` and `revocationReason`.
2. The registry is re-signed by the current active key.
3. Clients that cache the registry will pick up the revocation at the next
   refresh; clients that pin tools via `(id, publicKey)` SHOULD treat a
   revoked publicKey as a forced re-approval trigger.

Revocation is permanent: a revoked key cannot be unrevoked. To re-establish
trust the server must generate a new key.

## 6. Backwards compatibility

The endpoint is optional. A server that does not implement `GET /keys`
responds with `404 NOT_FOUND` and continues to operate exactly as in 0.2 —
verification falls back to per-card `publicKey`. The conformance suite's
`governance.keyRegistry` check is `skipped` for those servers.

A client that does not consult a registry continues to verify cards and
receipts as in 0.2; it simply cannot detect revocation.

## 7. Future work

- **External trust roots.** A `KeyRegistry` implementation backed by Sigstore
  / Rekor or by a CT log lives outside this RFC; the `KeyRegistry` interface
  is the integration point.
- **Provenance.** `CardAttestation` (already a card field) is independent of
  the registry; a single key may sign cards that also carry external
  attestation.
- **Cross-server identity.** A consumer that interacts with many Glyph
  servers may want a registry-of-registries; that is left to the consumer
  application.

## 8. Implementation notes

Reference implementation in this repository:

- `packages/core/src/key-registry.ts` — `KeyRegistry` interface, in-memory
  registry, file-backed registry, HTTP client.
- `packages/server` — exposes `GET /keys` when `serverOptions.keyRegistry`
  is provided.
- `packages/cli/src/commands/keys.ts` — `glyph keys init|rotate|revoke|list`.
