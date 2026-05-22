import { randomUUID } from 'node:crypto'
import { PROTOCOL_VERSION } from '@glyphp/types'
import type {
  ConfirmationTicket,
  GlyphCard,
  HandshakeRequest,
  HandshakeResponse,
  LexiconEntry,
  SealedEnvelope,
} from '@glyphp/types'

export { renderEnvelope, dataPreamble } from './render.js'
export type { RenderOptions } from './render.js'

export class GlyphClient {
  private baseUrl: string
  private consumerId: string
  private contextBudget: number
  private authToken?: string
  private extraHeaders: Record<string, string>
  private fetchImpl: typeof fetch

  constructor(options: {
    baseUrl: string
    consumerId?: string
    contextBudget?: number
    /** Bearer token sent as `Authorization: Bearer <token>` on every request. */
    authToken?: string
    /** Extra headers merged into every request. */
    headers?: Record<string, string>
    /**
     * fetch implementation to use — defaults to the global fetch. Inject an
     * in-process handler (e.g. a GlyphServer's `fetch`) to talk to a server
     * without a network round-trip, which is also how the client is tested.
     */
    fetch?: typeof fetch
  }) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '')
    this.consumerId = options.consumerId ?? randomUUID()
    this.contextBudget = options.contextBudget ?? 50000
    this.authToken = options.authToken
    this.extraHeaders = options.headers ?? {}
    this.fetchImpl = options.fetch ?? globalThis.fetch
  }

  async connect(options?: {
    cardDepth?: 'minimal' | 'standard' | 'rich'
  }): Promise<HandshakeResponse> {
    const body: HandshakeRequest = {
      protocolVersion: PROTOCOL_VERSION,
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
    return this.get<GlyphCard>(`/glyphs/${encodeURIComponent(name)}${query}`)
  }

  // Prepare a confirmation ticket — required before calling a glyph whose
  // card declares cost.requiresConfirmation.
  async prepare(name: string, input: unknown): Promise<ConfirmationTicket> {
    return this.post<ConfirmationTicket>(
      `/glyphs/${encodeURIComponent(name)}/prepare`,
      { input }
    )
  }

  async call<T = unknown>(
    name: string,
    input: unknown,
    options?: { confirmationToken?: string }
  ): Promise<SealedEnvelope & { payload: T }> {
    const callId = randomUUID()
    const envelope = await this.post<SealedEnvelope>(
      `/glyphs/${encodeURIComponent(name)}/call`,
      {
        input,
        callId,
        confirmationToken: options?.confirmationToken,
      }
    )
    return envelope as SealedEnvelope & { payload: T }
  }

  async invoke<T = unknown>(
    name: string,
    input: unknown,
    options?: { confirmationToken?: string }
  ): Promise<T> {
    const envelope = await this.call<T>(name, input, options)
    return envelope.payload
  }

  /** Builds the header set for a request, applying auth and any extra headers. */
  private buildHeaders(json: boolean): Headers {
    const headers = new Headers(this.extraHeaders)
    if (json) headers.set('Content-Type', 'application/json')
    if (this.authToken) headers.set('Authorization', `Bearer ${this.authToken}`)
    return headers
  }

  private async get<T>(path: string): Promise<T> {
    const res = await this.fetchImpl(
      new Request(`${this.baseUrl}${path}`, {
        headers: this.buildHeaders(false),
      })
    )
    if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`)
    return res.json() as Promise<T>
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const res = await this.fetchImpl(
      new Request(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: this.buildHeaders(true),
        body: JSON.stringify(body),
      })
    )
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`POST ${path} failed: ${res.status} — ${text}`)
    }
    return res.json() as Promise<T>
  }
}
