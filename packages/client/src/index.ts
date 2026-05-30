import { randomUUID } from 'node:crypto'
import type { AttestationVerifier } from '@glyphp/core'
import {
  AttestationVerifierRegistry,
  canonicalHash,
  verifyReceipt as coreVerifyReceipt,
  diffCards,
  verifyGlyph,
  verifyManifest,
} from '@glyphp/core'
import type {
  CallReceipt,
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
import { SigstoreVerifier, SlsaVerifier } from './attestation.js'
import type { PendingAuditEntry, PendingAuditQueue } from './audit-queue.js'
import { MemoryPendingAuditQueue } from './audit-queue.js'
import type { PinStore } from './pins.js'
import { ProviderTrustResolver } from './trust.js'

export type { CardDiff, Pin, UpdateManifest } from '@glyphp/types'
export { SigstoreVerifier, SlsaVerifier } from './attestation.js'
export type { PendingAuditEntry, PendingAuditQueue } from './audit-queue.js'
export { MemoryPendingAuditQueue } from './audit-queue.js'
export { FilePinStore } from './file-pin-store.js'
export type { PinStore } from './pins.js'
export { MemoryPinStore } from './pins.js'
export type { RenderOptions } from './render.js'
export { dataPreamble, renderEnvelope } from './render.js'
export { ProviderTrustResolver } from './trust.js'

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
 * Thrown by call() when trust enforcement is active and the provider is
 * unknown or its signing key is not in the trusted set.
 */
export class GlyphTrustError extends Error {
  readonly provider: string
  readonly reason: 'unknown_provider' | 'untrusted_key'
  constructor(provider: string, reason: 'unknown_provider' | 'untrusted_key') {
    super(
      reason === 'unknown_provider'
        ? `Provider "${provider}" is not in the trust registry`
        : `Provider "${provider}" signing key is not trusted`,
    )
    this.name = 'GlyphTrustError'
    this.provider = provider
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

/**
 * Thrown by call() when attestation policy requires a valid attestation and
 * the card is unattested, or all verifiers reject the attestation.
 */
export class GlyphAttestationError extends Error {
  readonly toolName: string
  readonly details?: string
  constructor(toolName: string, details?: string) {
    super(
      `Tool "${toolName}" requires attestation but none is valid${details ? ` — ${details}` : ''}`,
    )
    this.name = 'GlyphAttestationError'
    this.toolName = toolName
    this.details = details
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

/** Configuration for provider trust enforcement. See TRUSTREG-002. */
export interface TrustConfig {
  /** When true, every call() checks the provider against the trust registry. */
  enabled: boolean
  /**
   * The resolver used to look up provider trust entries. When omitted,
   * a default resolver with HTTP + filesystem discovery is created.
   */
  resolver?: ProviderTrustResolver
  /**
   * When true, providers that are not in the trust registry are allowed to
   * execute. Defaults to false — unknown providers are rejected.
   */
  allowUnknownProviders?: boolean
}

export class GlyphClient {
  private baseUrl: string
  private consumerId: string
  private contextBudget: number
  private authToken?: string
  private extraHeaders: Record<string, string>
  private fetchImpl: typeof fetch
  private pins?: PinStore
  private secureMode: boolean
  private autoApproveReviewChanges: boolean
  private verifyReceipts: boolean
  private attestationRegistry: AttestationVerifierRegistry
  private requireAttestation: 'none' | 'danger' | 'all'
  /** Per-session cache of verified rich cards, keyed by tool name. */
  private cardCache = new Map<string, GlyphCard>()
  /** Trust configuration — when enabled, every call is gated by provider trust. */
  private trustEnabled: boolean
  private trustResolver?: ProviderTrustResolver
  private trustAllowUnknown: boolean
  /** When true, a detected card change is parked for audit instead of throwing. */
  private resilientUpdates: boolean
  private pendingAuditQueue?: PendingAuditQueue
  private onPendingAudit?: (entry: PendingAuditEntry) => void

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
    /**
     * When secureMode is active, review-only card changes (intent, tags,
     * examples, etc.) are blocked by default. Set this to `true` to restore
     * the auto-approve behaviour for review-only changes while keeping all
     * other secureMode protections.
     */
    autoApproveReviewChanges?: boolean
    /**
     * When secureMode is active, receipts included in call responses are
     * verified against the pinned card's key and content before the payload
     * is returned to the caller. Defaults to `true` in secureMode. Set to
     * `false` to opt out (e.g. for servers that don't sign receipts yet).
     */
    verifyReceipts?: boolean
    /**
     * Provider trust enforcement. When enabled, every call() verifies the
     * tool's provider against a trust registry. Unknown providers are
     * rejected unless `allowUnknownProviders` is true. Untrusted signing
     * keys are always rejected. See {@link TrustConfig}.
     */
    trust?: TrustConfig
    /**
     * Attestation verification policy. Controls whether tools must carry a
     * valid external attestation (Sigstore, SLSA, etc.) before execution.
     * - `'none'` (default): no attestation required — fully backward compatible.
     * - `'danger'`: only tools with `riskTier: 'danger'` must have a valid attestation.
     * - `'all'`: every tool must have a valid attestation.
     */
    requireAttestation?: 'none' | 'danger' | 'all'
    /**
     * Custom attestation verifiers to register alongside the built-in
     * SigstoreVerifier and SlsaVerifier. Each verifier must implement
     * {@link AttestationVerifier}.
     */
    attestationVerifiers?: AttestationVerifier[]
    /**
     * Fail-to-last-known-good instead of fail-closed. When true, a tool whose
     * card changed since approval is NOT rejected: the new card is parked in
     * the {@link PendingAuditQueue} for later audit while call() keeps running
     * the last approved (stable) pin. A never-pinned tool still throws — there
     * is no stable version to fall back to. Defaults to `false`: the strict
     * gate is unchanged. Requires a PinStore.
     */
    resilientUpdates?: boolean
    /**
     * Where parked tool updates await audit. Defaults to an in-memory queue
     * when resilientUpdates is enabled. Supply a persistent implementation to
     * keep the queue across restarts.
     */
    pendingAuditQueue?: PendingAuditQueue
    /** Invoked each time a changed tool is parked for audit. */
    onPendingAudit?: (entry: PendingAuditEntry) => void
  }) {
    if (options.secureMode && !options.pins) {
      throw new Error(
        'GlyphClient: secureMode requires a PinStore (use FilePinStore for persistence)',
      )
    }
    if (options.resilientUpdates && !options.pins) {
      throw new Error('GlyphClient: resilientUpdates requires a PinStore')
    }
    this.baseUrl = options.baseUrl.replace(/\/$/, '')
    this.consumerId = options.consumerId ?? randomUUID()
    this.contextBudget = options.contextBudget ?? 50000
    this.authToken = options.authToken
    this.extraHeaders = options.headers ?? {}
    this.fetchImpl = options.fetch ?? globalThis.fetch
    this.pins = options.pins
    this.secureMode = options.secureMode ?? false
    this.autoApproveReviewChanges = options.autoApproveReviewChanges ?? false
    this.verifyReceipts = options.verifyReceipts ?? true
    this.trustEnabled = options.trust?.enabled ?? false
    this.trustResolver = options.trust?.resolver
    this.trustAllowUnknown = options.trust?.allowUnknownProviders ?? false
    this.resilientUpdates = options.resilientUpdates ?? false
    this.pendingAuditQueue =
      options.pendingAuditQueue ??
      (this.resilientUpdates ? new MemoryPendingAuditQueue() : undefined)
    this.onPendingAudit = options.onPendingAudit
    this.requireAttestation = options.requireAttestation ?? 'none'
    this.attestationRegistry = new AttestationVerifierRegistry()
    // Register built-in verifiers
    this.attestationRegistry.register(new SigstoreVerifier())
    this.attestationRegistry.register(new SlsaVerifier())
    // Register user-provided verifiers
    for (const v of options.attestationVerifiers ?? []) {
      this.attestationRegistry.register(v)
    }
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
    await this.enforceTrust(name)
    await this.ensureAttested(name)
    const callId = randomUUID()
    const envelope = await this.post<SealedEnvelope>(`/glyphs/${encodeURIComponent(name)}/call`, {
      input,
      callId,
      confirmationToken: options?.confirmationToken,
    })
    // In secureMode with receipt verification enabled (the default), validate
    // the receipt against the pinned card before returning the payload. When a
    // resilient update is parked for this tool, the stable pin — not the
    // unaudited new card — governs: a server that actually swapped to the new
    // card produces a receipt whose glyphId won't match the pin, so its output
    // is rejected. The unaudited card's result never reaches the caller.
    if (this.secureMode && this.verifyReceipts && this.pins) {
      const pending = this.resilientUpdates ? await this.pendingAuditQueue?.get(name) : undefined
      const card = pending ? (await this.pins.get(name))?.card : this.cardCache.get(name)
      if (card) this.verifyReceipt(envelope, card)
    }
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

  /**
   * Verifies a call receipt against the pinned card's key and content.
   * Called during call() when secureMode is active and verifyReceipts is
   * not explicitly disabled. Throws GlyphVerificationError on any mismatch.
   */
  private verifyReceipt(envelope: SealedEnvelope, card: GlyphCard): void {
    const receipt = envelope.receipt as CallReceipt | undefined
    if (!receipt) return // No receipt to verify — skip silently.

    // (a) The receipt must be signed by the pinned key, not some other key.
    if (receipt.serverPublicKey !== card.publicKey) {
      throw new GlyphVerificationError(`Receipt for "${card.name}"`)
    }

    // (b) Signature integrity — reuses core's ed25519 verification.
    if (!coreVerifyReceipt(receipt)) {
      throw new GlyphVerificationError(`Receipt for "${card.name}"`)
    }

    // (c) The receipt must attest to the card we approved.
    if (receipt.glyphId !== card.id) {
      throw new GlyphVerificationError(`Receipt for "${card.name}"`)
    }

    // (d) outputHash must match the actual payload we received.
    const actualOutputHash = canonicalHash(envelope.payload)
    if (actualOutputHash !== receipt.outputHash) {
      throw new GlyphVerificationError(`Receipt for "${card.name}"`)
    }

    // (e) inspectionHash must match the actual inspection in the envelope.
    const actualInspectionHash = canonicalHash(envelope.inspection ?? {})
    if (actualInspectionHash !== receipt.inspectionHash) {
      throw new GlyphVerificationError(`Receipt for "${card.name}"`)
    }
  }

  private requirePins(): PinStore {
    if (!this.pins) {
      throw new Error('GlyphClient was constructed without a PinStore')
    }
    return this.pins
  }

  /**
   * Trust gate for call(): when trust is enabled, the provider must be
   * known to the trust registry and the card's signing key must be in the
   * provider's trusted set.
   */
  private async enforceTrust(name: string): Promise<void> {
    if (!this.trustEnabled) return

    let card = this.cardCache.get(name)
    if (!card) card = await this.getCard(name)

    const provider = card.provider
    const resolver = this.trustResolver ?? new ProviderTrustResolver({})

    const entry = await resolver.resolve(provider)
    if (!entry) {
      if (this.trustAllowUnknown) return
      throw new GlyphTrustError(provider, 'unknown_provider')
    }

    // The card's publicKey must be in the provider's trusted set.
    if (!card.publicKey || !entry.publicKeys.includes(card.publicKey)) {
      throw new GlyphTrustError(provider, 'untrusted_key')
    }
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
    // In secureMode, review-only changes (intent, tags, examples) are NOT
    // auto-approved unless the caller explicitly opted in via
    // `autoApproveReviewChanges`. Even descriptive metadata can affect tool
    // selection by AI agents, so the default is strict.
    if (this.secureMode && !this.autoApproveReviewChanges) {
      // Fall through to the throw below — every change requires human approval.
    }
    // Auto-approve non-breaking changes (e.g. intent rewording, example updates).
    // Breaking changes — key swaps, risk escalation, schema changes — still
    // require explicit human re-approval.
    else if (
      inspection.status === 'changed' &&
      inspection.diff &&
      !inspection.diff.requiresApproval
    ) {
      if (inspection.pin) {
        const updated: Pin = { ...inspection.pin, card, approvedAt: new Date().toISOString() }
        await this.pins.set(updated)
        return
      }
    }
    // Resilient updates: a tool we have a stable pin for changed in a way that
    // would otherwise block. Instead of breaking the workflow, park the new
    // card for audit and keep running the stable pin. A 'new' tool has no
    // stable version to fall back to, so it still throws below.
    if (
      this.resilientUpdates &&
      inspection.status === 'changed' &&
      inspection.pin &&
      inspection.diff
    ) {
      const entry: PendingAuditEntry = {
        toolName: name,
        newCard: card,
        diff: inspection.diff,
        detectedAt: new Date().toISOString(),
      }
      await this.pendingAuditQueue?.enqueue(entry)
      this.onPendingAudit?.(entry)
      return
    }
    throw new GlyphNotApprovedError(name, inspection.status, inspection.diff)
  }

  /** Lists the tool updates currently parked awaiting audit. */
  async pendingAudits(): Promise<PendingAuditEntry[]> {
    return (await this.pendingAuditQueue?.list()) ?? []
  }

  /**
   * Attestation gate for call(): when requireAttestation is not 'none',
   * validates that the card carries a verifiable external attestation
   * before execution. The policy controls which risk tiers require it.
   */
  private async ensureAttested(name: string): Promise<void> {
    if (this.requireAttestation === 'none') return

    let card = this.cardCache.get(name)
    if (!card) card = await this.getCard(name)
    if (card.name !== name) throw new GlyphVerificationError(`Card "${name}"`)

    // Determine whether attestation is required for this tool
    const required =
      this.requireAttestation === 'all' ||
      (this.requireAttestation === 'danger' && card.cost.riskTier === 'danger')

    if (!required) return

    // Card must carry an attestation
    if (!card.attestation) {
      throw new GlyphAttestationError(
        name,
        `card has no attestation (policy: ${this.requireAttestation})`,
      )
    }

    // Run all registered verifiers
    let anyValid = false
    const failures: string[] = []
    for (const verifierType of this.attestationRegistry.list()) {
      const verifier = this.attestationRegistry.get(verifierType)
      if (!verifier) continue
      const result = await verifier.verify(card)
      if (result.valid && result.trusted !== false) {
        anyValid = true
        break // One trusted attestation type is sufficient
      }
      if (result.valid && result.trusted === false) {
        failures.push(`${verifier.type}: structural validation only`)
      } else if (result.error) {
        failures.push(`${verifierType}: ${result.error}`)
      }
    }

    if (!anyValid) {
      throw new GlyphAttestationError(
        name,
        failures.length > 0
          ? `all verifiers rejected: ${failures.join('; ')}`
          : 'no matching verifier',
      )
    }
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
