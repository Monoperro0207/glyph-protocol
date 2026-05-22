import { randomUUID } from 'node:crypto'
import { Hono } from 'hono'
import type { Context } from 'hono'
import { serve } from '@hono/node-server'
import {
  toLexiconEntry,
  applyDepth,
  sealResult,
  signGlyph,
  signReceipt,
  generateKeyPair,
  canonicalHash,
  sanitize,
} from '@glyphp/core'
import type { GlyphKeyPair } from '@glyphp/core'
import { PROTOCOL_VERSION } from '@glyphp/types'
import type {
  CallReceipt,
  ConfirmationTicket,
  HandshakeRequest,
  HandshakeResponse,
} from '@glyphp/types'
import type { GlyphDefinition } from './define.js'
import { authMiddleware, rateLimitMiddleware, buildVerify } from './middleware.js'
import type { AuthConfig, RateLimitConfig } from './middleware.js'
import { errorResponse } from './errors.js'

const SERVER_VERSION = '0.1.0'
const RECEIPT_VERSION = '0.2'
const CONFIRMATION_TTL_MS = 5 * 60_000
const DEFAULT_CALL_TIMEOUT_MS = 30_000

class HandlerTimeoutError extends Error {}

/** Thrown when a request body cannot be parsed as JSON. */
class MalformedJsonError extends Error {}

/** Reads and parses a JSON request body, normalizing a parse failure. */
async function readJson<T>(c: Context): Promise<T> {
  try {
    return (await c.req.json()) as T
  } catch {
    throw new MalformedJsonError()
  }
}

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  onTimeout?: () => void
): Promise<T> {
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
  private pendingConfirmations = new Map<
    string,
    { glyphName: string; inputHash: string; expiresAt: number }
  >()
  private port: number
  private keyPair: GlyphKeyPair
  private auth?: AuthConfig
  private rateLimit?: RateLimitConfig
  private callTimeoutMs: number
  private onCall?: (receipt: CallReceipt) => void

  constructor(options?: {
    port?: number
    keyPair?: GlyphKeyPair
    auth?: AuthConfig
    rateLimit?: RateLimitConfig
    callTimeoutMs?: number
    onCall?: (receipt: CallReceipt) => void
  }) {
    this.port = options?.port ?? 3100
    this.auth = options?.auth
    this.rateLimit = options?.rateLimit
    this.callTimeoutMs = options?.callTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS
    this.onCall = options?.onCall
    if (options?.keyPair) {
      this.keyPair = options.keyPair
    } else {
      this.keyPair = generateKeyPair()
      console.warn(
        '[glyph] No keyPair provided — generated an ephemeral one for this run.'
      )
    }
    console.log('[glyph] provider publicKey:', this.keyPair.publicKey)
    this.setupRoutes()
  }

  register(glyph: GlyphDefinition<any, any>): this {
    if (this.glyphs.has(glyph.card.name)) {
      throw new Error(
        `A glyph named "${glyph.card.name}" is already registered`
      )
    }
    const signedCard = {
      ...glyph.card,
      publicKey: this.keyPair.publicKey,
      signature: signGlyph(glyph.card, this.keyPair.privateKey),
    }
    this.glyphs.set(signedCard.name, { ...glyph, card: signedCard })
    return this
  }

  /** The request handler — usable in any fetch-based runtime, or for tests. */
  get fetch() {
    return this.app.fetch
  }

  private setupRoutes() {
    const { app } = this

    app.onError((err, c) => {
      if (err instanceof MalformedJsonError) {
        return errorResponse(
          c,
          400,
          'MALFORMED_JSON',
          'Request body is not valid JSON'
        )
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
      })
    )

    app.post('/handshake', async (c) => {
      const body = await readJson<HandshakeRequest>(c)

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
          }
        )
      }

      const lexicon = Array.from(this.glyphs.values()).map((g) =>
        toLexiconEntry(g.card)
      )
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
      const lexicon = Array.from(this.glyphs.values()).map((g) =>
        toLexiconEntry(g.card)
      )
      return c.json(lexicon)
    })

    app.get('/glyphs/:name', (c) => {
      const name = c.req.param('name')
      const depth = (c.req.query('depth') as 'minimal' | 'standard' | 'rich') ?? 'rich'
      const glyph = this.glyphs.get(name)
      if (!glyph) return errorResponse(c, 404, 'NOT_FOUND', 'Glyph not found')
      return c.json(applyDepth(glyph.card, depth))
    })

    app.post('/glyphs/:name/prepare', async (c) => {
      const name = c.req.param('name')
      const glyph = this.glyphs.get(name)
      if (!glyph) return errorResponse(c, 404, 'NOT_FOUND', 'Glyph not found')

      const body = await readJson<{ input: unknown }>(c)
      const parsed = glyph.inputSchema.safeParse(body.input)
      if (!parsed.success) {
        return errorResponse(
          c,
          400,
          'VALIDATION_FAILED',
          'Input validation failed',
          parsed.error.issues
        )
      }

      const now = Date.now()
      if (this.pendingConfirmations.size > 1000) {
        for (const [token, pending] of this.pendingConfirmations) {
          if (now >= pending.expiresAt) this.pendingConfirmations.delete(token)
        }
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
      }>(c)
      const callId = body.callId ?? randomUUID()

      const parsed = glyph.inputSchema.safeParse(body.input)
      if (!parsed.success) {
        return errorResponse(
          c,
          400,
          'VALIDATION_FAILED',
          'Input validation failed',
          parsed.error.issues
        )
      }

      // Policy gate: a glyph that declares requiresConfirmation cannot run
      // without a single-use confirmation token, bound to this exact glyph
      // and input, obtained from POST /glyphs/:name/prepare.
      if (glyph.card.cost.requiresConfirmation) {
        const token = body.confirmationToken
        const pending = token ? this.pendingConfirmations.get(token) : undefined
        if (!token || !pending) {
          return errorResponse(
            c,
            403,
            'CONFIRMATION_REQUIRED',
            'This glyph requires confirmation',
            {
              glyph: name,
              cost: glyph.card.cost,
              hint: `POST /glyphs/${name}/prepare to obtain a confirmation token`,
            }
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
            'Invalid, expired, or mismatched confirmation token'
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
          () => controller.abort()
        )
      } catch (err) {
        if (err instanceof HandlerTimeoutError) {
          return errorResponse(
            c,
            504,
            'HANDLER_TIMEOUT',
            `Handler exceeded the ${this.callTimeoutMs}ms timeout`
          )
        }
        return errorResponse(
          c,
          502,
          'HANDLER_ERROR',
          err instanceof Error ? err.message : 'The handler threw an error'
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
          checked.error.issues
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
        serverPublicKey: this.keyPair.publicKey,
      }
      const receipt: CallReceipt = {
        ...receiptBase,
        signature: signReceipt(receiptBase, this.keyPair.privateKey),
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
        inspection
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
