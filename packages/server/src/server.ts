import { randomUUID, createHash } from 'node:crypto'
import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import {
  toLexiconEntry,
  applyDepth,
  sealResult,
  signGlyph,
  generateKeyPair,
  canonicalize,
} from '@glyph/core'
import type { GlyphKeyPair } from '@glyph/core'
import type {
  ConfirmationTicket,
  HandshakeRequest,
  HandshakeResponse,
} from '@glyph/types'
import type { GlyphDefinition } from './define.js'
import { authMiddleware, rateLimitMiddleware } from './middleware.js'
import type { AuthConfig, RateLimitConfig } from './middleware.js'

const SERVER_VERSION = '0.1.0'
const CONFIRMATION_TTL_MS = 5 * 60_000

function hashInput(input: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(input)))
    .digest('hex')
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

  constructor(options?: {
    port?: number
    keyPair?: GlyphKeyPair
    auth?: AuthConfig
    rateLimit?: RateLimitConfig
  }) {
    this.port = options?.port ?? 3100
    this.auth = options?.auth
    this.rateLimit = options?.rateLimit
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

    if (this.rateLimit) app.use('*', rateLimitMiddleware(this.rateLimit))
    if (this.auth) app.use('*', authMiddleware(this.auth))

    app.get('/health', (c) =>
      c.json({ ok: true, version: SERVER_VERSION })
    )

    app.post('/handshake', async (c) => {
      const body = await c.req.json<HandshakeRequest>()
      const lexicon = Array.from(this.glyphs.values()).map((g) =>
        toLexiconEntry(g.card)
      )
      const response: HandshakeResponse = {
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
      if (!glyph) return c.json({ error: 'Not found' }, 404)
      return c.json(applyDepth(glyph.card, depth))
    })

    app.post('/glyphs/:name/prepare', async (c) => {
      const name = c.req.param('name')
      const glyph = this.glyphs.get(name)
      if (!glyph) return c.json({ error: 'Not found' }, 404)

      const body = await c.req.json<{ input: unknown }>()
      const parsed = glyph.inputSchema.safeParse(body.input)
      if (!parsed.success) {
        return c.json({ error: 'Validation failed', issues: parsed.error.issues }, 400)
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
        inputHash: hashInput(parsed.data),
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
      if (!glyph) return c.json({ error: 'Not found' }, 404)

      const body = await c.req.json<{
        input: unknown
        callId?: string
        confirmationToken?: string
      }>()
      const callId = body.callId ?? randomUUID()

      const parsed = glyph.inputSchema.safeParse(body.input)
      if (!parsed.success) {
        return c.json({ error: 'Validation failed', issues: parsed.error.issues }, 400)
      }

      // Policy gate: a glyph that declares requiresConfirmation cannot run
      // without a single-use confirmation token, bound to this exact glyph
      // and input, obtained from POST /glyphs/:name/prepare.
      if (glyph.card.cost.requiresConfirmation) {
        const token = body.confirmationToken
        const pending = token ? this.pendingConfirmations.get(token) : undefined
        if (!token || !pending) {
          return c.json(
            {
              error: 'Confirmation required',
              glyph: name,
              cost: glyph.card.cost,
              hint: `POST /glyphs/${name}/prepare to obtain a confirmation token`,
            },
            403
          )
        }
        this.pendingConfirmations.delete(token) // single-use
        const valid =
          Date.now() < pending.expiresAt &&
          pending.glyphName === name &&
          pending.inputHash === hashInput(parsed.data)
        if (!valid) {
          return c.json(
            { error: 'Invalid, expired, or mismatched confirmation token' },
            403
          )
        }
      }

      const start = Date.now()
      const result = await glyph.handler(parsed.data)
      const latencyMs = Date.now() - start

      const envelope = sealResult(glyph.card.id, callId, result, latencyMs, glyph.card.provider)

      // Enforce: envelope type must always be 'data'
      if (envelope.type !== 'data') {
        return c.json({ error: 'Invalid envelope type' }, 400)
      }

      return c.json(envelope)
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
