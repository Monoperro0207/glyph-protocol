# Glyph Protocol — threat model (STRIDE)

- **Status:** Operational reference
- **Applies to:** wire protocol 1.0
- **Author:** Patrick Espino
- **Created:** 2026-05-24

This document is not normative. It is the threat model the spec was
designed against, expressed in terms of [STRIDE] (Spoofing, Tampering,
Repudiation, Information disclosure, Denial of service, Elevation of
privilege). It lists what an attacker can try, what already stops them,
and what is **out of scope** for the protocol (so deployers know where
they own the residual risk).

[STRIDE]: https://learn.microsoft.com/en-us/azure/security/develop/threat-modeling-tool-threats

## 1. Assets

The protocol commits cryptographically — or behaviourally — to these
assets. Compromise of any of them is in scope.

| Asset | Owner | What protects it today |
|---|---|---|
| **Glyph card** (`name`, `intent`, `cost`, `input`, `output`, `requiredScopes`, …) | Provider | Content-addressed id (sha-256), ed25519 signature, optional `attestation` |
| **CallReceipt** (per-call signed audit record) | Provider | ed25519 signature anchored at `serverPublicKey`; commits to `inputHash`, `outputHash`, `inspectionHash` |
| **Confirmation token** (single-use, bound to glyph+input+TTL) | Server | Random UUID, 5 min TTL, single-use bookkeeping, bound by canonical input hash |
| **Provider key pair** | Provider | Operator-controlled storage; the key registry tracks rotation/revocation with chained signatures |
| **Key registry** (`GET /keys`) | Provider | Self-signature by the active key; consumer pins genesis fingerprint |
| **Pin store** (consumer-side approved cards) | Consumer | Local file (`FilePinStore`) or in-memory store; revocation is a first-class state |
| **Inert tool output** (payloads from upstream MCP/OpenAPI/handler) | Server | `sanitize()` removes Unicode-tags / zero-width / bidi-override / control chars / NFKC; the receipt commits to the sanitization report hash |
| **MCP / OpenAPI upstream** | Adapter | Output validation against the declared card output schema (502 OUTPUT_VALIDATION_FAILED on mismatch) |
| **Hermes-style sandbox workspace** | Server operator | `createJail()` resolves the full symlink chain on every read/write |

## 2. Trust boundaries

```
                ┌──────────────┐
                │   Consumer   │
                │  (LLM host)  │
                └──────┬───────┘
                       │  TLS, optional bearer token, optional JWT-like principal
                       │  (— consumer↔server boundary —)
                       ▼
        ┌──────────────────────────────┐
        │       Glyph Server           │
        │  - holds active key pair     │
        │  - publishes key registry    │
        │  - signs cards + receipts    │
        │  - enforces requiredScopes   │
        │  - enforces confirmation     │
        │  - sanitizes inert output    │
        └──────────────┬───────────────┘
                       │  (— server↔upstream boundary —)
                       ▼
           ┌──────────────────────┐
           │  Adapter targets     │
           │  - MCP server        │
           │  - OpenAPI service   │
           │  - Local handler     │
           │  - Local filesystem  │
           └──────────────────────┘
```

Each arrow is a trust boundary. The protocol's guarantees stop at the
boundary it cannot cross — see §6 "Out of scope".

## 3. Threat actors

- **Curious consumer.** A legitimate caller probing for misconfigurations.
- **Hostile provider.** Operates a server that tries to lie about a card,
  smuggle a prompt injection, or repudiate a call afterwards.
- **Compromised key holder.** Holds a provider private key after it should
  have been rotated/revoked.
- **Hostile upstream.** An MCP server or OpenAPI service that returns
  payloads designed to hijack the consumer model.
- **MITM on the wire.** Operator without TLS termination — see §6.
- **Local attacker on the host.** Has filesystem access to the workspace
  or the pin store — see §6.

## 4. STRIDE matrix

### 4.1 Spoofing

| Threat | Mitigation |
|---|---|
| An attacker claims to be the server | Card and receipt signatures verify against the *pinned* server public key (consumer side). A different key fails `verifyGlyph` / `verifyReceipt`. |
| An attacker swaps a freshly-rotated key for a key they control | The key registry's signature is chained — each new entry is signed by the previous active key. `GET /keys` carries the active fingerprint, and rotation is only accepted when the chain back to the pinned genesis is valid. See RFC-0001. |
| An attacker forges a confirmation token to bypass the confirmation gate | The server keeps a server-side pending map keyed by the random UUID, bound to `glyphName` and `canonicalHash(input)`. Forged tokens hit `INVALID_CONFIRMATION`. Tokens are single-use. |
| An attacker claims a glyph card they did not provide | The card id is `sha-256(canonical({name, intent, cost, input, output, …, requiredScopes, attestation}))`. Any field change flips the id; the signature must verify against the key advertised under `publicKey`. |

### 4.2 Tampering

| Threat | Mitigation |
|---|---|
| In-flight modification of a card | `verifyGlyph` re-computes the id from canonical content and verifies the signature; the consumer rejects any card whose id does not match its content or whose signature does not verify. |
| In-flight modification of a receipt | `verifyReceipt` checks the ed25519 signature over the canonical receipt content (including `inputHash`, `outputHash`, `inspectionHash`). |
| Server lies in the receipt about what was sanitized | The receipt commits to the canonical hash of the `inspection` report sent to the client. A receipt whose `inspectionHash` does not match what the client received is rejected. |
| A handler upstream returns out-of-schema output | Adapters (`@glyphp/adapter-mcp`, `@glyphp/adapter-openapi`) re-validate output against the declared output schema and emit `502 OUTPUT_VALIDATION_FAILED` rather than passing through. |
| Symlink chain in the workspace tricks the sandbox into writing outside | `createJail().jailedWritePath` calls `realpath()` (full chain) with a manual `walkChain` fallback for dangling chains, then rejects any path whose resolved target leaves the workspace. |

### 4.3 Repudiation

| Threat | Mitigation |
|---|---|
| Provider denies a call happened | The signed `CallReceipt` commits to `inputHash`, `outputHash`, `inspectionHash`, `timestamp`, `serverPublicKey`. A consumer that keeps the receipt has tamper-evident proof. |
| Consumer denies they invoked a high-risk glyph | The receipt's `callId` plus the consumer-supplied request body (which the receipt commits to via `inputHash`) gives the provider a corresponding proof. |
| Provider repudiates a previously published card | Cards are content-addressed; once a consumer pinned a `(id, publicKey)` pair, the provider cannot silently "withdraw" the contract — only republish a new card under a new id, surfaced by `diffCards` for the consumer's re-approval. |

### 4.4 Information disclosure

| Threat | Mitigation |
|---|---|
| A hostile glyph output smuggles a prompt-injection prompt into the model | Server-side `sanitize()` strips Unicode-tags, zero-width characters, bidi-override and control characters; the inspection report is signed; the client-side `renderEnvelope()` + `dataPreamble()` wraps payloads as inert data with a trusted system preamble. |
| A handler leaks data it should not return (incorrect implementation) | Output schema validation in the adapter or via `defineGlyph({ output })` rejects the response with `502 OUTPUT_VALIDATION_FAILED`. The protocol cannot stop a *valid* schema match from carrying sensitive content — that is a handler-design concern (see §6). |
| Confirmation token discloses the input it was prepared for | The token is opaque to the wire; the input is canonical-hashed before binding, not stored on the ticket. |
| A revoked key continues to authenticate cards | The key registry advertises `revokedAt`; consumers must reject cards or receipts whose signing key is revoked with `401 KEY_REVOKED`. |

### 4.5 Denial of service

| Threat | Mitigation |
|---|---|
| Flood of requests under one bearer token | `rateLimitMiddleware` with fixed-window per-token bucket. |
| Anonymous flood from many IPs | Same middleware, falls back to `ip:remote` bucket when the token is missing or unverified. |
| Slow / hanging handler | `withTimeout()` aborts after `callTimeoutMs`; returns `504 HANDLER_TIMEOUT`. The handler receives the `AbortSignal` so cooperative handlers stop their downstream calls. |
| Confirmation token map grows without bound | Eviction sweep when the pending map exceeds 1000 entries; tokens expire after 5 minutes. |
| Rotating fake tokens to escape the rate limit | The rate limiter only awards a per-token bucket to *verified* tokens. Unverified or absent tokens share the per-IP bucket. |
| Resource exhaustion from a malicious MCP/OpenAPI upstream | Output validation and adapter-level timeouts; the call still trips `HANDLER_ERROR` / `HANDLER_TIMEOUT`. |

### 4.6 Elevation of privilege

| Threat | Mitigation |
|---|---|
| A caller without scopes invokes a privileged glyph | RFC-0002: `requiredScopes` on the card + `policy: PolicyResolver` + `403 INSUFFICIENT_SCOPE` when missing. Scope is canonical card content, so a policy change forces consumer re-approval. |
| A confirmation token grants additional privileges beyond the bound call | The token is bound to `(glyphName, canonicalHash(input), expiresAt)`; using it for a different glyph or different input yields `403 INVALID_CONFIRMATION`. |
| A revoked tool keeps running on the consumer | `Pin.revokedAt` blocks execution even if the card still matches; clearing the revocation requires a deliberate re-approval. |
| An attacker confuses the consumer into approving an unsafe card | `diffCards` classifies field changes as `breaking` (security-relevant) vs `review` (descriptive). Approving a breaking diff requires explicit re-approval. |

## 5. Abuse cases

- **Malicious provider.** Publishes a glyph whose `input` schema looks
  benign but whose handler exfiltrates data. Mitigation: the consumer
  has the signed card before any call; the call returns through the
  inert-data layer; if `output` matches schema but smuggles instructions,
  `sanitize()` neutralises them and the inspection report flags it.
- **Key compromise.** Provider's active key leaks. Mitigation: rotate
  via key registry; mark the old key `revokedAt`; consumers refuse
  cards/receipts signed by it with `KEY_REVOKED`. Damage is bounded by
  whether the consumer's `KeyRegistry` source is reachable and verified.
- **MCP poisoning.** The MCP upstream returns content that is not in the
  declared output schema, hoping the bridge passes it through.
  Mitigation: adapter output validation → `502 OUTPUT_VALIDATION_FAILED`.
- **Symlink confused deputy.** Attacker plants a symlink chain that
  ends outside the workspace and asks the server to write into it.
  Mitigation: `createJail` resolves the full chain (audit-3 fix).
- **Replay of a previous request.** Attacker captures and replays a
  signed receipt or a confirmation token. Mitigation: receipts are
  per-call (they do not authorise a call, they only record one);
  confirmation tokens are single-use with a 5 min TTL and bound to the
  exact canonical input.

## 6. Out of scope

The protocol explicitly does **not** defend against these. Deployers
must address them at a lower layer.

- **Network confidentiality / authenticity.** The protocol assumes TLS
  between consumer and server. Run the server behind TLS termination
  in production (`examples/11-production-deploy` uses Caddy).
- **Sensitive data exfiltration by an authorised handler.** A handler
  whose output is valid per the schema can still ship data the consumer
  did not want shared. The card's `intent`/`cost`/`requiredScopes` give
  the consumer the *opportunity* to refuse before the call; the protocol
  does not introspect handler internals.
- **Local-machine compromise.** Pin store integrity, key file storage,
  workspace ACLs and handler process isolation are all host concerns.
- **Tenant data isolation.** `CallerPrincipal.tenant` is propagated, but
  partitioning storage by tenant is handler code, not protocol.
- **Side-channel attacks on cryptography.** ed25519 / sha-256 from
  `@noble/ed25519` and Node's `crypto` are the trust roots; the
  protocol does not guarantee constant-time execution beyond what those
  libraries offer.
- **Supply-chain attacks on the SDK.** Mitigated separately via npm
  provenance (OIDC, sigstore) and the SBOM/cosign attestations attached
  to each GitHub Release (see `.github/workflows/release.yml`).

## 7. Verifying a deployment against this model

A maintainer can re-run the relevant invariants with:

```bash
pnpm verify                    # signs/sanitises/timeouts/output-validation/receipts
pnpm conformance:self          # discovery, execution, security, governance
pnpm exec tsx --test packages/server/test/policy.test.ts            # scope gate
pnpm exec tsx --test examples/05-hermes-integration/test/jail.test.ts # symlink chain
```

Every row of §4 has at least one automated test in the suite; failing
tests indicate the corresponding mitigation has regressed.
