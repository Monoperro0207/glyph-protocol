import { randomUUID } from 'node:crypto'
import type { GlyphKeyPair, GlyphSigner, KeyRegistrySource } from '@glyphp/core'
import {
  Ed25519Signer,
  applyDepth,
  canonicalHash,
  generateKeyPair,
  sanitize,
  sealResult,
  toLexiconEntry,
} from '@glyphp/core'
import type {
  CallReceipt,
  ConfirmationTicket,
  HandshakeRequest,
  HandshakeResponse,
  UpdateManifest,
} from '@glyphp/types'
import { MANIFEST_VERSION, PROTOCOL_VERSION } from '@glyphp/types'
import { serve } from '@hono/node-server'
import type { Context } from 'hono'
import { Hono } from 'hono'
import type { GlyphDefinition } from './define.js'
import { errorResponse } from './errors.js'
import type { AuthConfig, RateLimitConfig } from './middleware.js'
import { authMiddleware, buildVerify, rateLimitMiddleware } from './middleware.js'
import type { CallerPrincipal, PolicyResolver } from './policy.js'
import { missingScopes } from './policy.js'

const SERVER_VERSION = '0.1.0'
const RECEIPT_VERSION = '0.3'
const CONFIRMATION_TTL_MS = 5 * 60_000
const MAX_PENDING_CONFIRMATIONS = 10_000
const DEFAULT_CALL_TIMEOUT_MS = 30_000
const MAX_BODY_BYTES = 1_048_576

class HandlerTimeoutError extends Error {}

/** Thrown when a request body cannot be parsed as JSON. */
class MalformedJsonError extends Error {}

/** Thrown when the request body exceeds the size limit. */
class PayloadTooLargeError extends Error {}

/** Reads and parses a JSON request body, enforcing a size limit. */
async function readJson<T>(c: Context, maxBytes: number): Promise<T> {
  const contentLength = c.req.header('content-length')
  if (contentLength) {
    const length = Number.parseInt(contentLength, 10)
    if (!Number.isNaN(length) && length > maxBytes) {
      throw new PayloadTooLargeError()
    }
  }
  try {
    // When Content-Length is absent, read the full body and measure its byte size
    // as a defense-in-depth fallback before parsing.
    if (!contentLength) {
      const raw = await c.req.raw.clone().arrayBuffer()
      if (raw.byteLength > maxBytes) {
        throw new PayloadTooLargeError()
      }
      const text = new TextDecoder().decode(raw)
      return JSON.parse(text) as T
    }
    return (await c.req.json()) as T
  } catch (err) {
    if (err instanceof PayloadTooLargeError) throw err
    if (err instanceof SyntaxError) throw new MalformedJsonError()
    throw new MalformedJsonError()
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, onTimeout?: () => void): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      onTimeout?.()
      reject(new HandlerTimeoutError())
    }, ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

export class GlyphServer {
  private app = new Hono()
  private glyphs = new Map<string, GlyphDefinition<any, any>>()
  private manifests = new Map<string, UpdateManifest>()
  private pendingConfirmations = new Map<
    string,
    { glyphName: string; inputHash: string; expiresAt: number }
  >()
  private port: number
  private signer: GlyphSigner
  private auth?: AuthConfig
  private rateLimit?: RateLimitConfig
  private callTimeoutMs: number
  private onCall?: (receipt: CallReceipt) => void
  private keyRegistry?: KeyRegistrySource
  private policy?: PolicyResolver
  private maxPendingConfirmations: number
  private maxBodyBytes: number

  constructor(options?: {
    port?: number
    keyPair?: GlyphKeyPair
    /** Pluggable signer — when provided, takes precedence over keyPair. */
    signer?: GlyphSigner
    auth?: AuthConfig
    rateLimit?: RateLimitConfig
    callTimeoutMs?: number
    onCall?: (receipt: CallReceipt) => void
    /**
     * Optional KeyRegistry source — when provided, served from `GET /keys`
     * so clients can verify which keys this server currently signs with.
     * See `spec/rfcs/RFC-0001-key-registry.md`.
     */
    keyRegistry?: KeyRegistrySource
    /**
     * Optional principal resolver. Called per request to decide which
     * scopes/tenant the caller carries. When set, glyphs that declare
     * `requiredScopes` are enforced; when unset, any glyph that declares
     * scopes is rejected with `403 INSUFFICIENT_SCOPE`. See
     * `spec/rfcs/RFC-0002-policy-layer.md`.
     */
    policy?: PolicyResolver
    /** Hard cap on the number of unexpired pending confirmations (default 10_000). */
    maxPendingConfirmations?: number
    /** Max request body size in bytes (default 1_048_576 = 1 MiB). */
    maxBodyBytes?: number
  }) {
    this.port = options?.port ?? 3100
    this.auth = options?.auth
    this.rateLimit = options?.rateLimit
    this.callTimeoutMs = options?.callTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS
    this.onCall = options?.onCall
    this.keyRegistry = options?.keyRegistry
    this.policy = options?.policy
    this.maxPendingConfirmations = options?.maxPendingConfirmations ?? MAX_PENDING_CONFIRMATIONS
    this.maxBodyBytes = options?.maxBodyBytes ?? MAX_BODY_BYTES
    if (options?.signer) {
      this.signer = options.signer
    } else if (options?.keyPair) {
      this.signer = new Ed25519Signer(options.keyPair)
    } else {
      const kp = generateKeyPair()
      this.signer = new Ed25519Signer(kp)
      console.warn('[glyph] No keyPair provided — generated an ephemeral one for this run.')
    }
    console.log('[glyph] provider publicKey:', this.signer.publicKey)
    this.setupRoutes()
  }

  register(glyph: GlyphDefinition<any, any>): this {
    if (this.glyphs.has(glyph.card.name)) {
      throw new Error(`A glyph named "${glyph.card.name}" is already registered`)
    }
    const signedCard = {
      ...glyph.card,
      publicKey: this.signer.publicKey,
      signature: this.signer.signGlyphSync(glyph.card),
    }
    this.glyphs.set(signedCard.name, { ...glyph, card: signedCard })
    return this
  }

  /**
   * Publishes a signed update manifest for an already-registered glyph: an
   * on-the-record statement that the tool changed from `previousCardId` to the
   * glyph's current card. The server fills in `newCardId`, `issuedAt` and the
   * signature. Served from `GET /glyphs/:name/manifest`. Optional — a server
   * that never calls this simply has no manifest to serve.
   */
  registerManifest(
    toolName: string,
    manifest: {
      previousCardId: string
      reason: string
      breaking: boolean
      securityImpact: 'none' | 'low' | 'high'
    },
  ): this {
    const glyph = this.glyphs.get(toolName)
    if (!glyph) {
      throw new Error(`Cannot register a manifest for unknown glyph "${toolName}"`)
    }
    const base: Omit<UpdateManifest, 'signature'> = {
      manifestVersion: MANIFEST_VERSION,
      toolName,
      previousCardId: manifest.previousCardId,
      newCardId: glyph.card.id,
      reason: manifest.reason,
      breaking: manifest.breaking,
      securityImpact: manifest.securityImpact,
      issuedAt: new Date().toISOString(),
      serverPublicKey: this.signer.publicKey,
    }
    this.manifests.set(toolName, {
      ...base,
      signature: this.signer.signManifestSync(base),
    })
    return this
  }

  /** The request handler — usable in any fetch-based runtime, or for tests. */
  get fetch() {
    return this.app.fetch
  }

  /**
   * Resolve the caller principal for a request. Returns `undefined` when no
   * policy resolver is configured or it returns nothing — `missingScopes`
   * then treats the caller as having no scopes.
   */
  private async resolvePrincipal(c: Context): Promise<CallerPrincipal | undefined> {
    if (!this.policy) return undefined
    try {
      return await this.policy(c)
    } catch (err) {
      console.error('[glyph] policy resolver threw:', err)
      return undefined
    }
  }

  private setupRoutes() {
    const { app } = this

    app.onError((err, c) => {
      if (err instanceof PayloadTooLargeError) {
        return errorResponse(
          c,
          413,
          'PAYLOAD_TOO_LARGE',
          'Request body exceeds the maximum allowed size',
        )
      }
      if (err instanceof MalformedJsonError) {
        return errorResponse(c, 400, 'MALFORMED_JSON', 'Request body is not valid JSON')
      }
      console.error('[glyph] unhandled error:', err)
      return errorResponse(c, 500, 'INTERNAL_ERROR', 'Internal server error')
    })

    // The rate limiter runs first, but it is given the auth verifier so an
    // unverified token cannot escape the limit by rotating fake values.
    if (this.rateLimit) {
      const verifyToken = this.auth ? buildVerify(this.auth) : undefined
      app.use('*', rateLimitMiddleware(this.rateLimit, verifyToken))
    }
    if (this.auth) app.use('*', authMiddleware(this.auth))

    app.get('/health', (c) =>
      c.json({
        ok: true,
        version: SERVER_VERSION,
        protocolVersion: PROTOCOL_VERSION,
      }),
    )

    // RFC-0001 Key Registry endpoint. Returns 404 when the server has not
    // been configured with one — clients fall back to per-card publicKey.
    app.get('/keys', async (c) => {
      if (!this.keyRegistry) {
        return errorResponse(c, 404, 'NOT_FOUND', 'No KeyRegistry published')
      }
      try {
        const registry = await this.keyRegistry.registry()
        return c.json(registry)
      } catch (err) {
        console.error('[glyph] /keys failed:', err)
        return errorResponse(
          c,
          500,
          'INTERNAL_ERROR',
          err instanceof Error ? err.message : 'KeyRegistry failed',
        )
      }
    })

    app.post('/handshake', async (c) => {
      const body = await readJson<HandshakeRequest>(c, this.maxBodyBytes)

      // Protocol version negotiation. While Glyph is 0.x, every minor is
      // potentially breaking — client and server must speak the same version.
      if (body.protocolVersion !== PROTOCOL_VERSION) {
        return errorResponse(
          c,
          426,
          'PROTOCOL_VERSION_UNSUPPORTED',
          `This server speaks Glyph protocol ${PROTOCOL_VERSION}`,
          {
            serverProtocolVersion: PROTOCOL_VERSION,
            clientProtocolVersion: body.protocolVersion ?? null,
          },
        )
      }

      const lexicon = Array.from(this.glyphs.values()).map((g) => toLexiconEntry(g.card))
      const response: HandshakeResponse = {
        protocolVersion: PROTOCOL_VERSION,
        sessionId: randomUUID(),
        lexicon,
        cardDepth: body.preferredCardDepth ?? 'standard',
        serverVersion: SERVER_VERSION,
      }
      return c.json(response)
    })

    app.get('/lexicon', (c) => {
      const lexicon = Array.from(this.glyphs.values()).map((g) => toLexiconEntry(g.card))
      return c.json(lexicon)
    })

    app.get('/glyphs/:name', (c) => {
      const name = c.req.param('name')
      const depthRaw = c.req.query('depth')
      const VALID_DEPTHS = ['minimal', 'standard', 'rich'] as const
      if (depthRaw !== undefined && !(VALID_DEPTHS as readonly string[]).includes(depthRaw)) {
        return errorResponse(c, 400, 'VALIDATION_FAILED', 'Invalid depth value', {
          field: 'depth',
          expected: VALID_DEPTHS,
          got: depthRaw,
        })
      }
      const depth = (depthRaw as (typeof VALID_DEPTHS)[number] | undefined) ?? 'rich'
      const glyph = this.glyphs.get(name)
      if (!glyph) return errorResponse(c, 404, 'NOT_FOUND', 'Glyph not found')
      return c.json(applyDepth(glyph.card, depth))
    })

    app.get('/glyphs/:name/manifest', (c) => {
      const name = c.req.param('name')
      if (!this.glyphs.has(name)) {
        return errorResponse(c, 404, 'NOT_FOUND', 'Glyph not found')
      }
      const manifest = this.manifests.get(name)
      if (!manifest) {
        return errorResponse(c, 404, 'NOT_FOUND', 'No update manifest for this glyph')
      }
      return c.json(manifest)
    })

    app.post('/glyphs/:name/prepare', async (c) => {
      const name = c.req.param('name')
      const glyph = this.glyphs.get(name)
      if (!glyph) return errorResponse(c, 404, 'NOT_FOUND', 'Glyph not found')

      const body = await readJson<{ input: unknown }>(c, this.maxBodyBytes)
      const parsed = glyph.inputSchema.safeParse(body.input)
      if (!parsed.success) {
        return errorResponse(
          c,
          400,
          'VALIDATION_FAILED',
          'Input validation failed',
          parsed.error.issues,
        )
      }

      // Same scope gate as /call: refuse to mint a confirmation token for a
      // caller that policy would reject at call time.
      const callerPrep = await this.resolvePrincipal(c)
      const missingPrep = missingScopes(glyph.card.requiredScopes, callerPrep)
      if (missingPrep.length > 0) {
        return errorResponse(
          c,
          403,
          'INSUFFICIENT_SCOPE',
          'Caller is missing one or more required scopes',
          { glyph: name, missing: missingPrep },
        )
      }

      const now = Date.now()
      // Unconditional sweep: expired entries are always cleaned before
      // checking the hard limit so short-lived spikes self-recover.
      for (const [token, pending] of this.pendingConfirmations) {
        if (now >= pending.expiresAt) this.pendingConfirmations.delete(token)
      }

      if (this.pendingConfirmations.size >= this.maxPendingConfirmations) {
        // Pick the earliest expiring entry to derive a reasonable Retry-After.
        let earliestExpiry = Infinity
        for (const pending of this.pendingConfirmations.values()) {
          if (pending.expiresAt < earliestExpiry) earliestExpiry = pending.expiresAt
        }
        const retryAfter = Math.max(1, Math.ceil((earliestExpiry - now) / 1000))
        c.header('Retry-After', String(retryAfter))
        return errorResponse(
          c,
          503,
          'CONFIRMATION_BACKLOG_FULL',
          'Too many pending confirmations. Retry after the next ticket expires.',
          { maxPendingConfirmations: this.maxPendingConfirmations },
        )
      }

      const confirmationToken = randomUUID()
      const expiresAt = now + CONFIRMATION_TTL_MS
      this.pendingConfirmations.set(confirmationToken, {
        glyphName: name,
        inputHash: canonicalHash(parsed.data),
        expiresAt,
      })

      const ticket: ConfirmationTicket = {
        confirmationToken,
        glyphId: glyph.card.id,
        name: glyph.card.name,
        cost: glyph.card.cost,
        input: parsed.data,
        expiresAt: new Date(expiresAt).toISOString(),
      }
      return c.json(ticket)
    })

    app.post('/glyphs/:name/call', async (c) => {
      const name = c.req.param('name')
      const glyph = this.glyphs.get(name)
      if (!glyph) return errorResponse(c, 404, 'NOT_FOUND', 'Glyph not found')

      const body = await readJson<{
        input: unknown
        callId?: string
        confirmationToken?: string
      }>(c, this.maxBodyBytes)
      const clientCallId = body.callId
      const callId = randomUUID()

      const parsed = glyph.inputSchema.safeParse(body.input)
      if (!parsed.success) {
        return errorResponse(
          c,
          400,
          'VALIDATION_FAILED',
          'Input validation failed',
          parsed.error.issues,
        )
      }

      // RFC-0002 scope gate: a glyph that declares requiredScopes can only
      // be invoked by a caller whose principal carries every listed scope.
      // Resolved BEFORE the confirmation gate so we never burn a single-use
      // confirmation token on a request that policy would have rejected.
      const caller = await this.resolvePrincipal(c)
      const missing = missingScopes(glyph.card.requiredScopes, caller)
      if (missing.length > 0) {
        return errorResponse(
          c,
          403,
          'INSUFFICIENT_SCOPE',
          'Caller is missing one or more required scopes',
          { glyph: name, missing },
        )
      }

      // Policy gate: a glyph that declares requiresConfirmation cannot run
      // without a single-use confirmation token, bound to this exact glyph
      // and input, obtained from POST /glyphs/:name/prepare.
      if (glyph.card.cost.requiresConfirmation) {
        const token = body.confirmationToken
        // Spec distinguishes "missing token" from "token present but unknown/
        // expired/mismatched" — they are different failure modes for clients
        // and conformance tests to reason about.
        if (!token) {
          return errorResponse(
            c,
            403,
            'CONFIRMATION_REQUIRED',
            'This glyph requires confirmation',
            {
              glyph: name,
              cost: glyph.card.cost,
              hint: `POST /glyphs/${name}/prepare to obtain a confirmation token`,
            },
          )
        }
        const pending = this.pendingConfirmations.get(token)
        if (!pending) {
          return errorResponse(
            c,
            403,
            'INVALID_CONFIRMATION',
            'Unknown or already-consumed confirmation token',
          )
        }
        this.pendingConfirmations.delete(token) // single-use
        const valid =
          Date.now() < pending.expiresAt &&
          pending.glyphName === name &&
          pending.inputHash === canonicalHash(parsed.data)
        if (!valid) {
          return errorResponse(
            c,
            403,
            'INVALID_CONFIRMATION',
            'Expired or mismatched confirmation token',
          )
        }
      }

      // The handler gets an AbortSignal that fires on timeout. A cooperating
      // handler forwards it to fetch/child processes so a timed-out call stops
      // doing real work; one that ignores it still runs to completion.
      const controller = new AbortController()
      const start = Date.now()
      let result: unknown
      try {
        result = await withTimeout(
          glyph.handler(parsed.data, { signal: controller.signal }),
          this.callTimeoutMs,
          () => controller.abort(),
        )
      } catch (err) {
        if (err instanceof HandlerTimeoutError) {
          return errorResponse(
            c,
            504,
            'HANDLER_TIMEOUT',
            `Handler exceeded the ${this.callTimeoutMs}ms timeout`,
          )
        }
        return errorResponse(
          c,
          502,
          'HANDLER_ERROR',
          err instanceof Error ? err.message : 'The handler threw an error',
        )
      }
      const latencyMs = Date.now() - start

      const checked = glyph.outputSchema.safeParse(result)
      if (!checked.success) {
        return errorResponse(
          c,
          502,
          'OUTPUT_VALIDATION_FAILED',
          'Handler output did not match the declared output schema',
          checked.error.issues,
        )
      }

      // Make "inert data" literal: strip invisible / dangerous characters from
      // the output before it is delivered or hashed. The receipt commits to
      // the sanitized payload and to the report of what was removed.
      const { value: cleanOutput, report: inspection } = sanitize(checked.data)

      // Signed audit receipt: a tamper-evident record of this execution.
      const receiptBase: Omit<CallReceipt, 'signature'> = {
        receiptVersion: RECEIPT_VERSION,
        callId,
        glyphId: glyph.card.id,
        glyphName: glyph.card.name,
        inputHash: canonicalHash(parsed.data),
        outputHash: canonicalHash(cleanOutput),
        inspectionHash: canonicalHash(inspection),
        riskTier: glyph.card.cost.riskTier,
        provider: glyph.card.provider,
        latencyMs,
        timestamp: new Date().toISOString(),
        serverPublicKey: this.signer.publicKey,
        ...(clientCallId ? { clientCallId } : {}),
      }
      const receipt: CallReceipt = {
        ...receiptBase,
        signature: await this.signer.signReceipt(receiptBase),
      }
      if (this.onCall) {
        try {
          this.onCall(receipt)
        } catch (err) {
          console.error('[glyph] onCall audit hook threw:', err)
        }
      }

      const envelope = sealResult(
        glyph.card.id,
        callId,
        cleanOutput,
        latencyMs,
        glyph.card.provider,
        inspection,
      )
      return c.json({ ...envelope, receipt })
    })
  }

  async start(): Promise<void> {
    return new Promise((resolve) => {
      serve({ fetch: this.app.fetch, port: this.port }, () => {
        console.log(`Glyph server running on http://localhost:${this.port}`)
        resolve()
      })
    })
  }
}
