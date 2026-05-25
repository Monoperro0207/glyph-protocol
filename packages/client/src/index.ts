import { randomUUID } from 'node:crypto'
import { diffCards, verifyGlyph, verifyManifest } from '@glyphp/core'
import type {
  CardDiff,
  ConfirmationTicket,
  GlyphCard,
  HandshakeRequest,
  HandshakeResponse,
  LexiconEntry,
  Pin,
  SealedEnvelope,
  UpdateManifest,
} from '@glyphp/types'
import { PROTOCOL_VERSION } from '@glyphp/types'
import type { PinStore } from './pins.js'

export type { CardDiff, Pin, UpdateManifest } from '@glyphp/types'
export { FilePinStore } from './file-pin-store.js'
export type { PinStore } from './pins.js'
export { MemoryPinStore } from './pins.js'
export type { RenderOptions } from './render.js'
export { dataPreamble, renderEnvelope } from './render.js'

/** Thrown when a signed artifact (a card or a manifest) fails verification. */
export class GlyphVerificationError extends Error {
  constructor(subject: string) {
    super(`${subject} failed signature verification`)
    this.name = 'GlyphVerificationError'
  }
}

/**
 * Thrown by call() when a tool has been revoked by the consumer. A revoked
 * tool stays blocked until a deliberate `approveCard(card, { reinstate: true })`.
 */
export class GlyphRevokedError extends Error {
  readonly toolName: string
  readonly reason?: string
  constructor(toolName: string, reason?: string) {
    super(
      `Tool "${toolName}" was revoked${reason ? ` (${reason})` : ''} — reinstate it with approveCard(card, { reinstate: true }) after review`,
    )
    this.name = 'GlyphRevokedError'
    this.toolName = toolName
    this.reason = reason
  }
}

/**
 * Thrown by call() when a PinStore is configured and the tool is not approved
 * — either never pinned ('new') or changed since approval ('changed'). For a
 * changed tool, `diff` explains what moved so a human can review and re-approve.
 */
export class GlyphNotApprovedError extends Error {
  readonly toolName: string
  readonly status: 'new' | 'changed'
  readonly diff?: CardDiff
  constructor(toolName: string, status: 'new' | 'changed', diff?: CardDiff) {
    super(
      status === 'new'
        ? `Tool "${toolName}" is not approved — review its card and call approveCard()`
        : `Tool "${toolName}" changed since approval — review the diff and re-approve`,
    )
    this.name = 'GlyphNotApprovedError'
    this.toolName = toolName
    this.status = status
    this.diff = diff
  }
}

/** The pin status of a card relative to what the PinStore has approved. */
export interface CardInspection {
  status: 'new' | 'unchanged' | 'changed' | 'revoked'
  /** The matching pin, when one exists (any status but 'new'). */
  pin?: Pin
  /** What changed since approval — present only when status is 'changed'. */
  diff?: CardDiff
}

/** The pin status of one lexicon entry, matched by id alone (no key check). */
export interface LexiconInspection {
  name: string
  status: 'new' | 'unchanged' | 'changed' | 'revoked'
}

export class GlyphClient {
  private baseUrl: string
  private consumerId: string
  private contextBudget: number
  private authToken?: string
  private extraHeaders: Record<string, string>
  private fetchImpl: typeof fetch
  private pins?: PinStore
  /** Per-session cache of verified rich cards, keyed by tool name. */
  private cardCache = new Map<string, GlyphCard>()

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
    /**
     * Approved-card store. When set, call() refuses any tool that is not
     * pinned, or whose card changed since it was approved. Without it, the
     * client behaves as before — no pin gate.
     */
    pins?: PinStore
    /**
     * Refuses to construct without a PinStore. Use this for production
     * agents that should never accidentally run a tool the user has not
     * approved — `secureMode: true` + a persistent {@link FilePinStore} is
     * the recommended posture.
     */
    secureMode?: boolean
  }) {
    if (options.secureMode && !options.pins) {
      throw new Error(
        'GlyphClient: secureMode requires a PinStore (use FilePinStore for persistence)',
      )
    }
    this.baseUrl = options.baseUrl.replace(/\/$/, '')
    this.consumerId = options.consumerId ?? randomUUID()
    this.contextBudget = options.contextBudget ?? 50000
    this.authToken = options.authToken
    this.extraHeaders = options.headers ?? {}
    this.fetchImpl = options.fetch ?? globalThis.fetch
    this.pins = options.pins
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

  async getCard(name: string, depth?: 'minimal' | 'standard' | 'rich'): Promise<GlyphCard> {
    const query = depth ? `?depth=${depth}` : ''
    const card = await this.get<GlyphCard>(`/glyphs/${encodeURIComponent(name)}${query}`)
    // A card that carries a signature must verify — present-but-invalid means
    // tampering. Depth-stripped cards carry none; they cannot be verified or
    // pinned, and the pin gate rejects them downstream.
    if (card.signature && !verifyGlyph(card)) {
      throw new GlyphVerificationError(`Card "${name}"`)
    }
    if (card.signature && card.publicKey) this.cardCache.set(name, card)
    return card
  }

  // Prepare a confirmation ticket — required before calling a glyph whose
  // card declares cost.requiresConfirmation.
  async prepare(name: string, input: unknown): Promise<ConfirmationTicket> {
    return this.post<ConfirmationTicket>(`/glyphs/${encodeURIComponent(name)}/prepare`, { input })
  }

  async call<T = unknown>(
    name: string,
    input: unknown,
    options?: { confirmationToken?: string },
  ): Promise<SealedEnvelope & { payload: T }> {
    await this.ensureApproved(name)
    const callId = randomUUID()
    const envelope = await this.post<SealedEnvelope>(`/glyphs/${encodeURIComponent(name)}/call`, {
      input,
      callId,
      confirmationToken: options?.confirmationToken,
    })
    return envelope as SealedEnvelope & { payload: T }
  }

  async invoke<T = unknown>(
    name: string,
    input: unknown,
    options?: { confirmationToken?: string },
  ): Promise<T> {
    const envelope = await this.call<T>(name, input, options)
    return envelope.payload
  }

  /**
   * Compares a card against the PinStore. Does not throw — returns the status
   * ('new' | 'unchanged' | 'changed') plus, for a changed card, a diff to
   * triage. Use it to drive a review-then-approve flow.
   */
  async inspectCard(card: GlyphCard): Promise<CardInspection> {
    const pin = await this.requirePins().get(card.name)
    if (!pin) return { status: 'new' }
    // A revocation dominates: a revoked tool is blocked regardless of whether
    // its card still matches.
    if (pin.revokedAt) return { status: 'revoked', pin }
    if (pin.card.id === card.id && pin.card.publicKey === card.publicKey) {
      return { status: 'unchanged', pin }
    }
    return { status: 'changed', pin, diff: diffCards(pin.card, card) }
  }

  /**
   * Approves a card: verifies its signature, then writes a pin keyed by the
   * card's name. After this, call() will run that exact (id, publicKey). This
   * is the explicit human-approval step — only call it after review.
   *
   * Approving a tool that is currently revoked requires `{ reinstate: true }`,
   * so a revocation can never be cleared by accident.
   */
  async approveCard(card: GlyphCard, options?: { reinstate?: boolean }): Promise<Pin> {
    if (!card.signature || !verifyGlyph(card)) {
      throw new GlyphVerificationError(`Card "${card.name}"`)
    }
    const store = this.requirePins()
    const existing = await store.get(card.name)
    if (existing?.revokedAt && !options?.reinstate) {
      throw new GlyphRevokedError(card.name, existing.revokeReason)
    }
    const pin: Pin = {
      toolName: card.name,
      approvedAt: new Date().toISOString(),
      card,
    }
    await store.set(pin)
    return pin
  }

  /**
   * Revokes a tool: marks its pin so call() refuses it even if the card still
   * matches. Idempotent. Throws if the tool has no pin — an un-pinned tool is
   * already blocked, so there is nothing to revoke. A revoked tool is cleared
   * only by `approveCard(card, { reinstate: true })`.
   */
  async revokeTool(toolName: string, reason?: string): Promise<Pin> {
    const store = this.requirePins()
    const pin = await store.get(toolName)
    if (!pin) {
      throw new Error(
        `No pin for "${toolName}" — an unapproved tool is already blocked; nothing to revoke`,
      )
    }
    if (pin.revokedAt) return pin
    const revoked: Pin = {
      ...pin,
      revokedAt: new Date().toISOString(),
      revokeReason: reason,
    }
    await store.set(revoked)
    return revoked
  }

  /**
   * Classifies every lexicon entry against the PinStore by id alone — a cheap
   * early check right after connect(), before any card is fetched. It cannot
   * see a key swap (the lexicon carries no publicKey); getCard()/call() do.
   */
  async inspectLexicon(lexicon: LexiconEntry[]): Promise<LexiconInspection[]> {
    const pins = this.requirePins()
    const out: LexiconInspection[] = []
    for (const entry of lexicon) {
      const pin = await pins.get(entry.name)
      out.push({
        name: entry.name,
        status: !pin
          ? 'new'
          : pin.revokedAt
            ? 'revoked'
            : pin.card.id === entry.id
              ? 'unchanged'
              : 'changed',
      })
    }
    return out
  }

  /**
   * Fetches the optional signed update manifest for a tool. Returns `undefined`
   * when the server publishes none. The manifest is verified for
   * self-consistency, that it describes the requested tool, and — when a
   * PinStore is configured and a pin exists — that it is signed by the *pinned*
   * key. A manifest signed by a key the consumer never approved cannot be
   * trusted to describe the update, and is rejected.
   */
  async getManifest(name: string): Promise<UpdateManifest | undefined> {
    const res = await this.fetchImpl(
      new Request(`${this.baseUrl}/glyphs/${encodeURIComponent(name)}/manifest`, {
        headers: this.buildHeaders(false),
      }),
    )
    if (res.status === 404) return undefined
    if (!res.ok) {
      throw new Error(`GET /glyphs/${name}/manifest failed: ${res.status}`)
    }
    const manifest = (await res.json()) as UpdateManifest
    if (manifest.toolName !== name || !verifyManifest(manifest)) {
      throw new GlyphVerificationError(`Manifest for "${name}"`)
    }
    if (this.pins) {
      const pin = await this.pins.get(name)
      if (pin && pin.card.publicKey !== manifest.serverPublicKey) {
        throw new GlyphVerificationError(`Manifest for "${name}"`)
      }
    }
    return manifest
  }

  private requirePins(): PinStore {
    if (!this.pins) {
      throw new Error('GlyphClient was constructed without a PinStore')
    }
    return this.pins
  }

  /**
   * Pin gate for call(): with a PinStore configured, a tool must have a pin
   * that still matches its current card. A new tool throws
   * GlyphNotApprovedError. A changed tool whose diff is breaking throws.
   * A changed tool whose diff is non-breaking ('review') auto-updates its
   * pin so execution resumes without human re-approval.
   */
  private async ensureApproved(name: string): Promise<void> {
    if (!this.pins) return
    let card = this.cardCache.get(name)
    if (!card) card = await this.getCard(name)
    if (card.name !== name) throw new GlyphVerificationError(`Card "${name}"`)
    const inspection = await this.inspectCard(card)
    if (inspection.status === 'unchanged') return
    if (inspection.status === 'revoked') {
      throw new GlyphRevokedError(name, inspection.pin?.revokeReason)
    }
    // Auto-approve non-breaking changes (e.g. intent rewording, example updates).
    // Breaking changes — key swaps, risk escalation, schema changes — still
    // require explicit human re-approval.
    if (inspection.status === 'changed' && inspection.diff && !inspection.diff.requiresApproval) {
      if (inspection.pin) {
        const updated: Pin = { ...inspection.pin, card, approvedAt: new Date().toISOString() }
        await this.pins.set(updated)
        return
      }
    }
    throw new GlyphNotApprovedError(name, inspection.status, inspection.diff)
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
      }),
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
      }),
    )
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`POST ${path} failed: ${res.status} — ${text}`)
    }
    return res.json() as Promise<T>
  }
}
