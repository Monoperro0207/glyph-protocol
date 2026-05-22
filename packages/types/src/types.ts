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
  publicKey?: string
  signature?: string
  createdAt: string
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
