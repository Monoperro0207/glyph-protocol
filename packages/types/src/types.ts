export type JSONSchema = Record<string, unknown>

export type RiskTier = 'safe' | 'caution' | 'danger'

/** A consumer-curated trust entry for a glyph provider. See TRUSTREG-001. */
export interface ProviderTrustEntry {
  /** Org identifier, e.g. "github.com/my-org" or "glyph.acme.com". */
  provider: string
  /** Hex ed25519 public keys currently trusted for this provider. */
  publicKeys: string[]
  /** Optional pinned genesis key — the first key ever seen for this provider. */
  genesisKey?: string
  /** Optional policies that constrain what this provider's tools may do. */
  policies?: ProviderPolicies
  /** Optional URL to a conformance report (Sigstore bundle, SLSA, etc.). */
  conformanceReport?: string
  /** ISO date when this entry was registered/updated. */
  registeredAt?: string
}

/** Per-provider policies that gate tool execution. See TRUSTREG-002. */
export interface ProviderPolicies {
  /** Require attestation for tools of this risk or higher. */
  requireAttestation?: 'none' | 'danger' | 'all'
  /** Restrict execution to these risk tiers only. Empty = allow all. */
  allowedRiskTiers?: RiskTier[]
  /** Require receipt verification for every call (overrides client default). */
  requireReceiptVerification?: boolean
}

export interface GlyphCard {
  id: string
  version: string
  name: string
  intent: string
  tags: string[]
  cost: {
    latency: 'fast' | 'medium' | 'slow'
    sideEffects: boolean
    reversible: boolean
    riskTier: 'safe' | 'caution' | 'danger'
    requiresConfirmation: boolean
  }
  idempotent: boolean
  input: JSONSchema
  output: JSONSchema
  examples: Array<{
    description: string
    input: unknown
    output: unknown
  }>
  failureModes: Array<{
    code: string
    description: string
  }>
  provider: string
  /**
   * Optional policy scopes the caller MUST present (via the auth principal)
   * to invoke this glyph. When omitted, the glyph carries no scope
   * requirement and is callable by any authenticated caller (or anonymously
   * when the server has no auth gate). When non-empty, the server requires
   * every listed scope before executing — missing scopes return
   * `403 INSUFFICIENT_SCOPE`. The field is part of the canonical card
   * content, so changing it produces a new card id and forces consumer
   * re-approval. See `spec/rfcs/RFC-0002-policy-layer.md`.
   */
  requiredScopes?: string[]
  /**
   * Optional execution attestation: external evidence — produced outside the
   * SDK's trust boundary — of what code is actually running behind this
   * declared contract. The SDK never *produces* an attestation (it cannot
   * certify its own host process); it can only *verify* one against trust
   * roots the consumer already trusts. The payload is opaque to the SDK and
   * format-specific (Sigstore bundle, SLSA provenance, in-toto, etc.). When
   * present, the attestation enters the card's canonical content, so a
   * change to it produces a new card id — and is treated as a breaking
   * change by `diffCards`. See `spec/trust.md` and `spec/update-governance.md`.
   */
  attestation?: CardAttestation
  publicKey?: string
  signature?: string
  createdAt: string
}

/**
 * An opaque attestation envelope. The SDK commits to it (via the card id) but
 * does not interpret the payload — verification against a trust root is the
 * consumer's responsibility (or a future helper that knows the chosen format).
 */
export interface CardAttestation {
  /**
   * Identifier of the attestation format. Conventional values:
   * - `sigstore-bundle` — Sigstore bundle.v0.3 (cosign/rekor)
   * - `slsa-provenance` — SLSA Provenance v1.0
   * - `in-toto` — generic in-toto statement
   * - or any vendor-specific value the consumer recognizes
   */
  type: string
  /** The attestation payload, format-specific. Base64 or hex by convention. */
  payload: string
  /** Optional URL or identifier for an external transparency log / store. */
  reference?: string
}

export interface LexiconEntry {
  id: string
  name: string
  intent: string
  tags: string[]
  riskTier: 'safe' | 'caution' | 'danger'
}

export interface SealedEnvelope {
  type: 'data'
  glyphId: string
  callId: string
  payload: unknown
  meta: {
    latencyMs: number
    provider: string
    timestamp: string
  }
  /** What sanitize() removed from `payload` before it was delivered. */
  inspection?: Sanitization
  receipt?: CallReceipt
}

export interface CallReceipt {
  receiptVersion: string
  callId: string
  /** Optional client-supplied call identifier, preserved for correlation. */
  clientCallId?: string
  glyphId: string
  glyphName: string
  inputHash: string
  outputHash: string
  /** Canonical SHA-256 of the envelope's `inspection` report. */
  inspectionHash: string
  riskTier: 'safe' | 'caution' | 'danger'
  provider: string
  latencyMs: number
  timestamp: string
  serverPublicKey: string
  signature: string
}

export interface ControlMessage {
  type: 'control'
  source: 'system' | 'user'
  content: string
}

export interface HandshakeRequest {
  protocolVersion: string
  consumerId: string
  contextBudget: number
  preferredCardDepth: 'minimal' | 'standard' | 'rich'
}

export interface HandshakeResponse {
  protocolVersion: string
  sessionId: string
  lexicon: LexiconEntry[]
  cardDepth: 'minimal' | 'standard' | 'rich'
  serverVersion: string
}

export interface ConfirmationTicket {
  confirmationToken: string
  glyphId: string
  name: string
  cost: GlyphCard['cost']
  input: unknown
  expiresAt: string
}

export interface GlyphError {
  error: {
    code: string
    message: string
    details?: unknown
  }
}

/**
 * One category of neutralization applied by sanitize() to one string field.
 * `path` is a JSON-Pointer to the field; `count` is the number of affected
 * code points.
 */
export interface SanitizationFinding {
  path: string
  kind: 'unicode-tags' | 'zero-width' | 'bidi-override' | 'control-char' | 'nfkc-normalized'
  count: number
}

/**
 * The deterministic record of what sanitize() removed from a payload before
 * it was delivered. Carried on the SealedEnvelope and committed (by hash)
 * into the signed CallReceipt — so it is tamper-evident, not just advisory.
 */
export interface Sanitization {
  modified: boolean
  findings: SanitizationFinding[]
}

/**
 * One field that differs between an approved card and a newly seen one, with
 * a triage severity. `field` is a name or dotted path (e.g. "cost.riskTier").
 * `breaking` — a contract/security-relevant change that must not be trusted
 * without human re-approval. `review` — descriptive, worth a look, not a gate.
 */
export interface CardFieldChange {
  field: string
  severity: 'breaking' | 'review'
  before: unknown
  after: unknown
}

/**
 * The result of comparing an approved card against a newly seen one. The
 * content-addressed id is the *detector* — any canonical change already flips
 * it; this diff is the *explainer* a human uses to decide whether to re-approve.
 */
export interface CardDiff {
  changed: boolean
  /** The content-addressed id differs (any canonical field changed). */
  idChanged: boolean
  /** The signing key differs — the protocol id deliberately excludes publicKey. */
  keyChanged: boolean
  changes: CardFieldChange[]
  /** True if any change is 'breaking' — execution must not resume without re-approval. */
  requiresApproval: boolean
}

/**
 * A consumer-side record that a specific card was approved for a tool name.
 * The stored card's (id, publicKey) pair is the pinned identity: the id covers
 * content, the key covers provenance. The protocol id deliberately excludes
 * publicKey, so both must be pinned for "this is the tool I approved" to hold.
 *
 * A pin carrying `revokedAt` is a revocation: the consumer has explicitly
 * distrusted the tool. A revoked pin blocks execution even if the card still
 * matches, and is cleared only by a deliberate re-approval.
 */
export interface Pin {
  toolName: string
  approvedAt: string
  /** The exact card that was approved — kept so a later change can be diffed. */
  card: GlyphCard
  /** Set when the consumer has revoked this tool. Its presence blocks execution. */
  revokedAt?: string
  /** Optional human-readable reason recorded at revocation time. */
  revokeReason?: string
}

/**
 * One key in a server's published KeyRegistry (RFC-0001). The protocol-id
 * field is `fingerprint` (sha-256 of publicKey), which stays stable across
 * representations and rotations.
 */
export interface KeyEntry {
  fingerprint: string
  publicKey: string
  validFrom: string
  /** When this key was rotated out — absent on the active key. */
  validUntil?: string
  /** When this key was explicitly revoked. Mutually exclusive with active. */
  revokedAt?: string
  revocationReason?: string
  /** Fingerprint of the key that authorised this entry. Absent on the genesis. */
  signedBy?: string
  /** ed25519 signature by the signedBy key. Absent on the genesis. */
  signature?: string
  /** Multi-signer group metadata — present when this key is a FROST group key. */
  group?: {
    /** Minimum signers required (M). */
    threshold: number
    /** Total signers in the group (N). */
    participants: number
  }
}

/**
 * A Glyph server's published trust state — the keys it signs with right now,
 * the keys it has rotated out or revoked, and the chain-of-trust between
 * rotations. Served from `GET /keys`. See `spec/rfcs/RFC-0001-key-registry.md`.
 */
export interface KeyRegistry {
  registryVersion: '1.0'
  serverId: string
  /** Fingerprint of the active key. */
  active: string
  keys: KeyEntry[]
  issuedAt: string
  ttlSeconds: number
  /** ed25519 signature by the active key over the canonical hash of the rest. */
  signature: string
}

/**
 * A provider's signed, on-the-record statement that a tool changed from one
 * card to another. Optional and additive: it informs human review of an
 * update, it does not replace it. Signed by the server key — like a
 * CallReceipt — so a consumer MUST verify it against the *pinned* key, not
 * against a key embedded in the new card. See `spec/update-governance.md`.
 */
export interface UpdateManifest {
  /** Wire version of the manifest format (see MANIFEST_VERSION). */
  manifestVersion: string
  toolName: string
  previousCardId: string
  newCardId: string
  /** Human-readable description of the change. */
  reason: string
  /** The provider's own claim that the change breaks the contract. */
  breaking: boolean
  /** The provider's own claim about the security impact of the change. */
  securityImpact: 'none' | 'low' | 'high'
  issuedAt: string
  serverPublicKey: string
  /** Hex ed25519 signature over the canonical hash of every other field. */
  signature: string
}

/**
 * One provider listing inside a {@link PublicProvidersRegistry} (RFC-0003).
 * Inclusion is a *recommendation* by whoever signed the registry, not a
 * statement of correctness — identity remains the `(endpoint, publicKey)` pair.
 */
export interface RegistryProvider {
  name: string
  endpoint: string
  publicKey: string
  intent?: string
  conformanceBadge?: string
  lastVerifiedAt?: string
  tags?: string[]
  status: 'active' | 'revoked'
  revokedAt?: string
  revocationReason?: string
}

/**
 * A signed directory of Glyph providers, distributable as a single JSON file
 * at any URL the consumer trusts (RFC-0003). The signature is verified against
 * a `trustRoot` the consumer pins out of band — the registry is a directory,
 * not a name authority, and never auto-approves a glyph.
 */
export interface PublicProvidersRegistry {
  registryVersion: '1.0'
  /** Opaque identifier of who issued this registry — not a global name. */
  registryId: string
  issuedAt: string
  ttlSeconds: number
  providers: RegistryProvider[]
  signedBy: {
    name: string
    publicKey: string
    fingerprint: string
  }
  /** Hex ed25519 signature over the canonical hash of every other field. */
  signature: string
}
