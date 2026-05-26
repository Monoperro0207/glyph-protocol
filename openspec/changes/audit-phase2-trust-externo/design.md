# Design: Audit Phase 2 — External Trust & Production Hardening

## Technical Approach

Bottom-up layering: P1-3 (server hardening) → P1-1 (attestation verifiers) → P1-2 (trust registry). Each item independently verifiable. Follows existing plug-in patterns (`GlyphSigner`, `KeyRegistrySource`).

## Architecture Decisions

### Decision 1: Attestation verifier interface location

| Option | Tradeoff | Chosen |
|--------|----------|--------|
| `packages/types` | Types-only package, no runtime — breaks convention | |
| `packages/core` | Matches `GlyphSigner` pattern; already has `verifyAttestation()` | ✅ |

**Rationale**: `GlyphSigner`, `KeyRegistrySource`, and `Ed25519Signer` all live in `packages/core`. Consistency wins. Types stay wire-only.

### Decision 2: Built-in verifier location

| Option | Tradeoff | Chosen |
|--------|----------|--------|
| `packages/core` | Requires optional `@sigstore/sigstore` dep — bloats core | |
| `packages/client` | Verifiers consumed by client; deps are client-side concern | ✅ |

**Rationale**: Sigstore/SLSA verification brings heavy deps. Container-digest verifier (`sha256:`) needs zero deps — ships in core. `SigstoreVerifier` and `SlsaVerifier` are factory-created in `packages/client` where the dep can be optional via `peerDependencies`. Core defines the interface + registry.

### Decision 3: Client wiring — constructor option

**Choice**: `GlyphClientOptions.attestation: { verifiers?: AttestationVerifier[], policy: 'none' | 'danger' | 'all' }`

**Rationale**: Follows existing `GlyphClient` constructor pattern (`pins`, `secureMode`, `verifyReceipts`). Default registry has built-in verifiers; consumers extend via constructor.

### Decision 4: Provider trust registry location

**Choice**: Types in `packages/types`, discovery in `packages/client`.

**Rationale**: Provider trust is a client concern — the server doesn't consume it. Same split as `PinStore` (interface in client, types referenced from types). Discovery follows `FileKeyRegistry` / `HttpKeyRegistry` pattern from core.

### Decision 5: Discovery — HTTP then filesystem

**Choice**: `/.well-known/glyph-trust` → `.glyph-trust.json` fallback → per-tool pinning.

**Rationale**: Spec-mandated order. HTTP-first enables org-level trust without local config. Filesystem fallback supports air-gapped. Per-tool pinning remains the ultimate fallback (current behavior).

### Decision 6: Genesis key pinning — reuse KeyEntry chain

**Choice**: Reuse existing `KeyEntry` + `verifyKeyRegistry()` chain-of-trust from RFC-0001.

**Rationale**: The key registry already implements genesis-key → signed rotation → revocation. Provider trust entries use the same `KeyEntry[]` structure. No new chain logic needed — client calls `verifyKeyRegistry()` against the provider's published chain. The genesis fingerprint is what gets pinned.

### Decision 7: Production detection

**Choice**: `NODE_ENV=production` + new `strictProduction?: boolean` option (defaults `true` when production).

**Rationale**: `NODE_ENV` is the universal signal. `strictProduction` gives an explicit escape hatch (`GLYPH_SKIP_HARDENING` was removed in favor of a typed option — more testable, less magic). When `strictProduction: true` and configs missing, constructor throws. When `false`, warns.

## Component Diagram

```mermaid
graph TD
    subgraph Client["GlyphClient (packages/client)"]
        AP[Attestation Policy<br/>none | danger | all]
        VR[Verifier Registry]
        TR[Trust Resolver<br/>.well-known → .glyph-trust.json<br/>→ per-tool pin]
        PS[Pin Store]
    end

    subgraph Core["packages/core"]
        AV[AttestationVerifier<br/>interface]
        CD[DigestVerifier<br/>sha256: regex]
        KRS[KeyRegistrySource<br/>existing]
    end

    subgraph Server["GlyphServer (packages/server)"]
        PH[Production Hardening<br/>Guard]
    end

    subgraph Types["packages/types"]
        PT[ProviderTrustEntry]
        AR[AttestationResult]
    end

    AP --> VR
    VR --> AV
    TR --> KRS
    TR --> PS
    Client --> Types
    Core --> Types
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `packages/types/src/types.ts` | Modify | Add `AttestationResult`, `AttestationVerifier` (type only), `ProviderTrustEntry` |
| `packages/core/src/attestation.ts` | Create | `AttestationVerifier` interface, `AttestationVerifierRegistry`, `DigestVerifier` class |
| `packages/core/src/index.ts` | Modify | Export new attestation module, deprecate old `verifyAttestation()` shim |
| `packages/client/src/attestation.ts` | Create | `SigstoreVerifier`, `SlsaVerifier` factory functions |
| `packages/client/src/trust.ts` | Create | `ProviderTrustResolver`: HTTP discovery → `.glyph-trust.json` → fallback |
| `packages/client/src/index.ts` | Modify | Add `attestation` to `GlyphClientOptions`, wire enforcement into `ensureApproved()` |
| `packages/server/src/server.ts` | Modify | Add `strictProduction` option; production guard in constructor |
| `packages/cli/src/commands/init.ts` | Modify | Update `production-server` scaffold with `strictProduction: true` |

## Interfaces / Contracts

```ts
// packages/core/src/attestation.ts
interface AttestationVerifier {
  readonly type: string
  verify(card: GlyphCard): Promise<AttestationResult>
}

interface AttestationResult {
  status: 'valid' | 'invalid' | 'unknown'
  type: string
  identity?: string
  details?: Record<string, unknown>
}

// packages/types/src/types.ts
interface ProviderTrustEntry {
  org: string           // matches GlyphCard.provider
  genesis: string       // fingerprint of genesis ed25519 key
  keys: KeyEntry[]      // key chain from genesis (reuses existing type)
  policies?: { requireAttestation?: boolean }
}

// packages/server/src/server.ts
interface GlyphServerOptions {
  // ... existing options ...
  strictProduction?: boolean  // default: true when NODE_ENV=production
}
```

## Data Flow

```
Card arrives → client.ensureApproved()
  → attestation policy check:
      'none' → skip
      'danger' + riskTier=caution/safe → skip
      'danger' + riskTier=danger → run verifiers → reject on invalid
      'all' → run verifiers → reject on !valid
  → trust registry check (if configured):
      provider org → lookup trust entry → verify key chain from genesis
      → reject if unregistered + policy requires
  → existing pin check (unchanged)
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | DigestVerifier regex matching | Jest, pure function |
| Unit | AttestationResult shape on valid/invalid/unknown | Jest, mock card |
| Unit | Production guard throws/warns per config | Jest, `NODE_ENV` override |
| Integration | Client attestation policy: 'none'/'danger'/'all' | In-process GlyphServer + GlyphClient |
| Integration | Trust registry discovery: HTTP, filesystem, fallback | Mock fetch, temp file |
| E2E | `glyph init production-server` hardened scaffold | CLI smoke test |

## Migration / Rollout

No migration required. All additions are opt-in. `strictProduction` defaults to `true` in production, but existing servers without `NODE_ENV=production` are unaffected. Per-tool pinning remains the default fallback when no trust registry is configured.

## Open Questions

- [ ] Should `SigstoreVerifier` be a mandatory dep or optional peer? (Leaning optional — `unknown` status on missing dep)
- [ ] Should the `/.well-known/glyph-trust` endpoint be a new server route or a static file? (Spec says HTTP, so either works)
