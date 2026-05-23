export type JSONSchema = Record<string, unknown>

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
  kind:
    | 'unicode-tags'
    | 'zero-width'
    | 'bidi-override'
    | 'control-char'
    | 'nfkc-normalized'
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
