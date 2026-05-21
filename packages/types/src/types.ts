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
}

export interface ControlMessage {
  type: 'control'
  source: 'system' | 'user'
  content: string
}

export interface HandshakeRequest {
  consumerId: string
  contextBudget: number
  preferredCardDepth: 'minimal' | 'standard' | 'rich'
}

export interface HandshakeResponse {
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
