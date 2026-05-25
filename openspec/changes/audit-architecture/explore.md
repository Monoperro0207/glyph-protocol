# Exploration: audit-architecture

> Architectural audit of 5 concerns raised by security review — verified against actual code at `/packages/core/src/`, `/packages/server/src/`, `/packages/client/src/`, and `spec/`.

---

## Concern 1: Centralized trust model (single signer)

### Current State

The Glyph server holds a single ed25519 keypair (`GlyphServer.keyPair`) — one `publicKey`, one `privateKey`. Every card, receipt, and manifest is signed with this ONE key. The server's constructor accepts an optional `keyPair`, or auto-generates an ephemeral one.

**What exists:**
- A Key Registry (RFC-0001) that supports MULTIPLE keys in its `keys: KeyEntry[]` array. The registry tracks an ordered chain: genesis → rotation → active.
- `buildKeyRegistry()` selects exactly ONE active key: `[...opts.entries].reverse().find((e) => !e.validUntil && !e.revokedAt)`. The outer registry signature is produced by that single active key.
- `verifyKeyRegistry()` validates the chain-of-trust but still requires ONE `active` key for the outer signature.

**What's missing:**
- The registry holds multiple keys, but only ONE is "active" at any time. There is NO concurrent multiple-signer model.
- The server has exactly ONE `keyPair` field (`GlyphServer.keyPair: GlyphKeyPair`), not an array.
- All signing paths (`signGlyph`, `signManifest`, `signReceipt`) take a single private key — no multi-key or quorum signing.
- `spec/trust.md` §"What is NOT verified" explicitly states: "Key rotation and revocation. There is no mechanism to rotate or revoke a server key yet." — but this is now OUTDATED. RFC-0001 implemented rotation & revocation. However, the trust model still says: "Glyph as of v1.0 gives you tamper-evidence and provenance within ONE server's keyspace." — confirming the single-signer model.

### Affected Areas
- `packages/core/src/key-registry.ts` — `active: string` (single fingerprint), `buildKeyRegistry` picks ONE active
- `packages/server/src/server.ts` — single `keyPair: GlyphKeyPair`, all signing uses `this.keyPair.privateKey`
- `packages/core/src/index.ts` — `signGlyph()`, `signManifest()`, `signReceipt()` all single-key
- `spec/trust.md` — §"What is NOT verified", §"Threat posture"
- `spec/rfcs/RFC-0001-key-registry.md` — §7 "Future work" mentions "External trust roots" but NOT multi-signer

### Approaches

1. **Multi-key active set with threshold** — Allow `active` to be a set of fingerprints + a threshold `M-of-N`. The server holds N private keys; signing requires M of them.
   - Pros: Real cryptographic defense against single-key compromise. Aligns with well-known threshold signature schemes.
   - Cons: Ed25519 threshold signing is non-trivial (no native lib support). Requires protocol-level changes to cards, receipts, manifests. Major wire change.
   - Effort: **High**

2. **Co-signer model (delegated trust)** — Server signs with its own key AND includes a co-signature from an external HSM or key-vault service. The card/receipt carries a second `coSignerPublicKey` + `coSignature`.
   - Pros: Can be implemented incrementally. Doesn't break existing single-signer verification. HSM integration is practical.
   - Cons: Still a single primary signer; the co-signer is additive but optional. Trust is NOT distributed — it's layered.
   - Effort: **Medium**

3. **Accept the risk + operational hardening** — Document that the single-signer model is the current design, harden key storage (HSM, env vars, vault), and prioritize multi-signer for protocol 2.0.
   - Pros: Zero code change. Focuses effort on what's most impactful today.
   - Cons: The audit finding remains valid — a compromised server key still collapses the trust model.
   - Effort: **Low**

### Recommendation

Accept the single-signer model for protocol 1.x (Approach 3) but document it explicitly in `trust.md` as a known architectural limitation. Add a `spec/rfcs/RFC-NNNN-multisig.md` draft as future work. The key registry already supports multiple keys in sequence; the NEXT logical step is concurrent multi-key support with threshold. This is a protocol 2.0 feature.

---

## Concern 2: Key lifecycle management

### Current State

The key lifecycle is partially implemented. RFC-0001 defines rotation, revocation, and chain-of-trust — all of which are IMPLEMENTED in `packages/core/src/key-registry.ts`.

**What exists:**
- **Genesis creation**: `buildKeyEntry(publicKey, validFrom)` with no parent
- **Rotation**: `buildKeyEntry(newPublicKey, validFrom, { fingerprint: oldFp, privateKey: oldPrivKey })` — old key signs new key's entry. Old key gets `validUntil`.
- **Revocation**: `KeyEntry.revokedAt` + `revocationReason`. `resolveKey()` returns `{ status: 'revoked', reason }`. `verifyKeyRegistry()` rejects registries whose `active` key has `revokedAt`.
- **Chain-of-trust verification**: `verifyKeyRegistry()` walks each entry, verifies `signedBy` signature against parent public key.
- **Registry sources**: `StaticKeyRegistry`, `FileKeyRegistry` (atomic writes), `HttpKeyRegistry` (caching + verification)
- **CLI tooling**: `glyph keys init|rotate|revoke|list` (referenced in RFC-0001 §8)
- **Test coverage**: 11 tests in `packages/core/test/key-registry.test.ts` covering genesis, rotation chain, broken chain, revocation, file persistence, HTTP fetch verification, tampering detection.

**What's missing:**
- **Key recovery**: No mechanism to recover from a lost key. If the active private key is lost after rotating out the old one, there is no recovery path.
- **Key backup**: No backup format, no encrypted export, no seed phrase. The key is raw hex bytes.
- **Emergency rotation**: No concept of "this key is compromised, forcefully supersede it even without the old key's signature" — the chain-of-trust model requires the parent key to sign the successor. A fully compromised key that is also the active AND only key leaves no chain-of-trust path.
- **Key expiry**: `validUntil` exists but is only SET during rotation — it's not automatically enforced. A key sitting unrotated for years has no expiry.
- **Multi-server identity**: RFC-0001 §7 mentions "Cross-server identity" as future work.

### Affected Areas
- `packages/core/src/key-registry.ts` — rotation/revocation/chain verification exist; recovery and backup do not
- `packages/core/test/key-registry.test.ts` — tests chain integrity but no recovery/backup scenarios
- `spec/rfcs/RFC-0001-key-registry.md` — §7 "Future work" lists external trust roots and cross-server identity, NOT recovery
- `spec/trust.md` — §"What is NOT verified" is outdated (says no rotation/revocation exists, but it does)
- `spec/protocol.md` — §11 mentions key registry but doesn't describe lifecycle operations
- `packages/cli/src/commands/keys.ts` — referenced but not verified

### Approaches

1. **Implement full lifecycle (rotate, revoke, recover, backup)** in `packages/core` + `packages/cli`
   - Pros: Complete lifecycle. Recovery paths documented and tested.
   - Cons: Recovery from total loss is impossible without pre-existing backup — the best we can do is backup format + emergency rotation.
   - Effort: **Medium**

2. **Update `trust.md` to match reality** — the document says rotation doesn't exist when it does. Fix the docs first, then plan recovery as a separate change.
   - Pros: Low effort. Documentation truth before code changes.
   - Cons: The lifecycle gap (recovery, backup) remains unaddressed.
   - Effort: **Low**

3. **Archive RFC-0001 as Implemented** and open new RFCs for recovery + backup
   - Pros: Clean separation. RFC-0001 solved rotation/revocation — mark it done.
   - Cons: Process overhead for what could be a single change.
   - Effort: **Low**

### Recommendation

Approach 2 first (fix `trust.md` — it currently claims rotation/revocation doesn't exist, which is false since RFC-0001). Then Approach 3: archive RFC-0001 as Implemented and open a new RFC for recovery + backup. The rotation/revocation chain IS working and tested; the gap is operational tooling (backup format, emergency procedures) and documentation accuracy.

---

## Concern 3: Pin/trust model scaling

### Current State

Pins are consumer-side `(toolName, card: GlyphCard, approvedAt, revokedAt?)` records. A pin stores the ENTIRE approved card — not just its id, not its identity, the full card object. This is intentional per `update-governance.md` §3: "The pinned identity is the pair `(card.id, card.publicKey)`."

**What exists:**
- `Pin` interface (`@glyphp/types`): `{ toolName, approvedAt, card: GlyphCard, revokedAt?, revokeReason? }`
- `PinStore` interface: `get(toolName)` + `set(pin)` — keyed ONLY by tool name
- `MemoryPinStore`, `FilePinStore` — simple key-value stores
- `diffCards()`: Classifies field changes as `breaking` (security-relevant) vs `review` (descriptive). `requiresApproval: true` when any breaking change detected.
- Client lifecycle: `unknown → approved → changed → revoked`. `changed` blocks execution pending review.
- `CardDiff` structure: `changed`, `idChanged`, `keyChanged`, `changes[]`, `requiresApproval`

**What's missing:**
- **NO identity-based pinning**: You CANNOT pin to a `provider` identity (e.g., "acme.payments") instead of a specific `(id, publicKey)` pair. The pin is ALWAYS tied to a specific card hash.
- **NO auto-approval of non-breaking changes**: Even a `review`-only change (e.g., intent reworded) produces a new `id`, which means the pin no longer matches — execution is BLOCKED until the human re-approves. There is no "auto-approve review-level changes" mode.
- **NO pin scoping**: A pin is per-tool-name. There is no pattern-based pinning ("acme.*") or identity-based trust ("trust any card from provider X signed by key Y").
- **NO pin expiration**: Pins have no TTL. Once approved, a tool stays approved forever unless explicitly revoked.

The audit says "las tools evolucionan" — and they do, but the current model treats EVERY card-id change (even a typo fix in `intent`) as a trust-breaking event that requires full human re-review. The `diffCards()` EXPLAINS what changed, but the GATE is binary: either the pin matches (approved) or it doesn't (blocked).

### Affected Areas
- `packages/client/src/pins.ts` — `PinStore` interface: only `get`/`set` by toolName
- `packages/client/src/file-pin-store.ts` — `PinFile` format: `{ version: 1, pins: Record<string, Pin> }`
- `packages/client/src/index.ts` — `inspectCard()` returns `'changed'` when pin differs; no auto-approve path
- `packages/core/src/index.ts` — `diffCards()` classifies breaking vs review but the consumer doesn't USE the `review` classification to auto-approve
- `packages/types/src/types.ts` — `Pin` interface: fixed to a single `GlyphCard`
- `spec/update-governance.md` — §2 says "a verified card is never updated" which is correct for content-addressing but makes every minor change a trust event

### Approaches

1. **Add auto-approval for non-breaking changes** — When `diffCards` returns `requiresApproval: false`, the client auto-updates the pin to the new card without human intervention.
   - Pros: Tools CAN evolve non-breakingly without re-trust ceremonies. Matches the audit's concern about tool evolution.
   - Cons: A provider could make many small review-level changes that cumulatively change behavior. Risk of slow creep.
   - Effort: **Low**

2. **Add identity-based pinning** — Allow pins scoped to `provider` + `publicKey`: "trust any card from acme.payments signed by key X". The client auto-approves any card that matches both, subject to `diffCards` review.
   - Pros: Solves tool evolution at the provider level. A provider can iterate without re-approvals as long as they keep the same key.
   - Cons: Broader trust surface — a compromised provider key means all its tools are trusted. This is a significant protocol design change.
   - Effort: **Medium**

3. **Add pin scoping + TTL** — Allow pins with:
   - Pattern matching (`provider: "acme.*"`)
   - Maximum age (`approvedAt + maxAge`)
   - Auto-expiry after N non-breaking updates
   - Pros: Granular control without full identity trust.
   - Cons: Adds complexity to the simple pin model.
   - Effort: **Medium**

### Recommendation

Start with Approach 1 (auto-approval for `review`-only changes) — it's the smallest delta that addresses the audit concern. It uses existing `diffCards` infrastructure and requires only a consumer-side behavior change. The full identity-based trust model (Approach 2) is a protocol 2.0 concern.

---

## Concern 4: Multi-signer support

### Current State

**Confirmed: NOTHING exists.** There is no multi-signer, threshold signature, or co-signer code anywhere in the codebase.

**Evidence:**
- `grep` for `multi.?sig|threshold|multi.?signer` across the entire repository returned ZERO relevant matches. The only "threshold" matches are:
  - `spec/security.md` — body size thresholds (unrelated)
  - `openspec/` — schema complexity thresholds (unrelated)
  - `.changeset/server-hardening.md` — confirmation backlog threshold (unrelated)
- `packages/core/src/key-registry.ts` — `active: string` is a SINGLE fingerprint
- `packages/core/src/index.ts` — all signing functions take a single private key
- `packages/server/src/server.ts` — single `keyPair` field
- `spec/trust.md` — does not mention multi-sig at all. §"Threat posture" says "provenance within ONE server's keyspace"
- `spec/rfcs/RFC-0001-key-registry.md` — §7 "Future work" does NOT list multi-sig
- `spec/protocol.md` — no mention
- `spec/threat-model.md` — no mention
- `spec/security.md` — §"Server keys" discusses single-key protection only

### Affected Areas
- ALL signing paths: `signGlyph`, `signManifest`, `signReceipt`, `buildKeyRegistry`
- ALL verification paths: `verifyGlyph`, `verifyManifest`, `verifyReceipt`, `verifyKeyRegistry`
- `KeyRegistry.active` field (single `string`)
- Glyph card schema (`publicKey` is a single string)
- Wire types: `GlyphCard`, `CallReceipt`, `UpdateManifest` all carry a single `publicKey`/`serverPublicKey`
- Conformance levels — would add a new `governance.multiSig` check

### Approaches

1. **Protocol 2.0 feature** — Multi-signer is a major wire change. Draft an RFC, design the multi-key wire format, and target it for protocol 2.0.
   - Pros: Correct venue for a change this large. No rush for 1.x.
   - Cons: The audit finding remains valid until 2.0 ships.
   - Effort: **High**

2. **Document the limitation** — Add to `trust.md` and `threat-model.md` that Glyph 1.x is single-signer by design, and multi-signer is tracked as a known future work item.
   - Pros: Transparency. Sets expectations for adopters.
   - Cons: Doesn't add the capability.
   - Effort: **Low**

### Recommendation

Approach 2 for now: document the limitation clearly in `trust.md`. Multi-signer belongs in protocol 2.0. The key registry architecture (RFC-0001) is the right foundation to extend, but the wire format changes are too extensive for a 1.x patch.

---

## Concern 5: Bus factor / single maintainer

### Current State

The project has ONE maintainer: Patrick Espino (`GOVERNANCE.md` §"Roles"). The governance document explicitly states: "There is no formal voting body yet. Maintainer decisions are public and appealable via an issue or RFC."

**What exists:**
- `CONTRIBUTING.md` — thorough: setup instructions, directory map, what needs RFC vs not, CI checks, coding conventions, license. Good onboarding document.
- `GOVERNANCE.md` — clear about roles (Maintainer, Contributor, Implementer), versioning (wire vs package), RFC process, conformance levels. Explicit about single maintainer.
- `ARCHITECTURE.md` — Mermaid trust-boundary diagram, component map, key registry section, receipt flow, inert data, pin store, conformance levels, threat model. Excellent architectural overview.
- `CLAUDE.md` — project-level guidance for coding agents. Current state checkpoint, working style, memory protocol.
- `SECURITY.md` — present but not read (likely standard security policy)
- `CODEOWNERS` — exists (likely lists Monoperro0207)
- `spec/threat-model.md` — comprehensive STRIDE model
- `docs/threat-to-tests.md` — traceability matrix (89 rows, 17 test files, 20 conformance checks)
- CI/CD: `pnpm verify:full` across 3 toolchains (TS, Go, Python), changesets for releases
- `RELEASE.md`, `CHANGELOG-PROTOCOL.md`, `CHANGELOG.md` files at package level

**What's missing:**
- **Single bus factor**: One person can merge PRs, cut releases, sign the protocol. If Pat is unavailable, the project stalls.
- **No maintainer onboarding guide**: CONTRIBUTING.md helps contributors send patches but doesn't explain how someone becomes a maintainer.
- **No succession plan**: What happens if the maintainer steps away permanently?
- **No documented release process for non-maintainers**: The `changesets/action` automates publishing but a human must merge the Version Packages PR — and that human is one person.
- **No CLA or DCO**: CONTRIBUTING.md says Apache 2.0 but doesn't mention DCO sign-off.
- **No community channels**: No Discord, Slack, mailing list, or discussion forum mentioned.

### Affected Areas
- `GOVERNANCE.md` — §"Roles": single maintainer listed
- `CODEOWNERS` — likely single owner
- `.github/workflows/` — CI that gates on maintainer approval
- `RELEASE.md` — release process

### Approaches

1. **Add a second maintainer** — Identify an active contributor and add them as co-maintainer. Update GOVERNANCE.md, CODEOWNERS.
   - Pros: Directly addresses bus factor. Doubles review bandwidth.
   - Cons: Requires finding someone with the right expertise and availability. This is a people problem, not a code problem.
   - Effort: **Low** (process), **High** (finding the person)

2. **Document succession + emergency process** — Add to GOVERNANCE.md: what happens if the maintainer is unavailable for X weeks. Who has repo admin access. How to transfer npm ownership.
   - Pros: At least the path is documented. Can be done immediately.
   - Cons: Doesn't actually add another person — just documents the single point of failure.
   - Effort: **Low**

3. **Formalize maintainer onboarding** — Add a `MAINTAINERS.md` with: criteria for becoming a maintainer, responsibilities, onboarding checklist (repo access, npm 2FA, CI secrets, changesets knowledge).
   - Pros: Makes the path to becoming a maintainer explicit and transparent.
   - Cons: Without a second person actually stepping up, it's just a document.
   - Effort: **Low**

### Recommendation

All three — in sequence. First: document the succession process and maintainer onboarding (Approach 2 + 3). These are low-effort documents that show the project is thinking about sustainability. Then: work on Approach 1 (second maintainer) as a community-building effort. The fact that the architecture doc is thorough, the STRIDE model is complete, the CI is robust, and the threat-to-test mapping exists means a potential co-maintainer COULD ramp up — the technical documentation is solid. The gap is purely organizational.

---

## Overall Summary

| Concern | Status | Severity | Fixes for 1.x | Protocol 2.0 |
|---------|--------|----------|---------------|-------------|
| 1. Centralized trust (single signer) | Architecture limitation confirmed | **High** | Document in `trust.md`; RFC draft | Multi-key active set + threshold |
| 2. Key lifecycle management | Partially implemented — rotation/revocation exist, recovery/backup missing | **Medium** | Fix `trust.md` (outdated); archive RFC-0001 as Implemented; new RFC for recovery | Backup format, emergency procedures |
| 3. Pin/trust model scaling | Pin model works but is brittle — every change blocks execution | **Medium** | Auto-approve `review`-only changes (`diffCards.requiresApproval: false`) | Identity-based trust, pin scoping |
| 4. Multi-signer support | **Nothing exists** | **High** (future) | Document limitation in `trust.md` | Full multi-sig protocol design |
| 5. Bus factor / single maintainer | Single maintainer confirmed | **Medium** | Document succession + maintainer onboarding; seek co-maintainer | N/A (organizational) |

### Ready for Proposal

**Yes.** The exploration confirms all 5 audit concerns are valid. Each has a clear path forward:

1. Document single-signer limitation + draft multi-sig RFC for 2.0
2. Fix `trust.md` (it's outdated about rotation/revocation), archive RFC-0001, draft recovery RFC
3. Implement auto-approval for non-breaking changes in `@glyphp/client`
4. Document multi-sig absence in `trust.md`
5. Add succession docs + maintainer onboarding guide

The biggest immediate win is **Concern 2** (trust.md is factually wrong — it says rotation doesn't exist) and **Concern 3** (auto-approving non-breaking changes would dramatically reduce trust-ceremony fatigue).
