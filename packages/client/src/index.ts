import { randomUUID } from 'node:crypto'
import type {
  GlyphCard,
  HandshakeRequest,
  HandshakeResponse,
  LexiconEntry,
  SealedEnvelope,
} from '@glyph/types'

export class GlyphClient {
  private baseUrl: string
  private consumerId: string
  private contextBudget: number

  constructor(options: {
    baseUrl: string
    consumerId?: string
    contextBudget?: number
  }) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '')
    this.consumerId = options.consumerId ?? randomUUID()
    this.contextBudget = options.contextBudget ?? 50000
  }

  async connect(options?: {
    cardDepth?: 'minimal' | 'standard' | 'rich'
  }): Promise<HandshakeResponse> {
    const body: HandshakeRequest = {
      consumerId: this.consumerId,
      contextBudget: this.contextBudget,
      preferredCardDepth: options?.cardDepth ?? 'standard',
    }
    return this.post<HandshakeResponse>('/handshake', body)
  }

  async getLexicon(): Promise<LexiconEntry[]> {
    return this.get<LexiconEntry[]>('/lexicon')
  }

  async getCard(
    name: string,
    depth?: 'minimal' | 'standard' | 'rich'
  ): Promise<GlyphCard> {
    const query = depth ? `?depth=${depth}` : ''
    return this.get<GlyphCard>(`/glyphs/${name}${query}`)
  }

  async call<T = unknown>(
    name: string,
    input: unknown
  ): Promise<SealedEnvelope & { payload: T }> {
    const callId = randomUUID()
    const envelope = await this.post<SealedEnvelope>(`/glyphs/${name}/call`, {
      input,
      callId,
    })
    return envelope as SealedEnvelope & { payload: T }
  }

  async invoke<T = unknown>(name: string, input: unknown): Promise<T> {
    const envelope = await this.call<T>(name, input)
    return envelope.payload
  }

  private async get<T>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`)
    if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`)
    return res.json() as Promise<T>
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`POST ${path} failed: ${res.status} — ${text}`)
    }
    return res.json() as Promise<T>
  }
}
