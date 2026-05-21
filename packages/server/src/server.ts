import { randomUUID } from 'node:crypto'
import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { toLexiconEntry, applyDepth, sealResult } from '@glyph/core'
import type { HandshakeRequest, HandshakeResponse } from '@glyph/types'
import type { GlyphDefinition } from './define.js'

const SERVER_VERSION = '0.1.0'

export class GlyphServer {
  private app = new Hono()
  private glyphs = new Map<string, GlyphDefinition<any, any>>()
  private port: number

  constructor(options?: { port?: number }) {
    this.port = options?.port ?? 3100
    this.setupRoutes()
  }

  register(glyph: GlyphDefinition<any, any>): this {
    this.glyphs.set(glyph.card.name, glyph)
    return this
  }

  private setupRoutes() {
    const { app } = this

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

    app.post('/glyphs/:name/call', async (c) => {
      const name = c.req.param('name')
      const glyph = this.glyphs.get(name)
      if (!glyph) return c.json({ error: 'Not found' }, 404)

      const body = await c.req.json<{ input: unknown; callId?: string }>()
      const callId = body.callId ?? randomUUID()

      const parsed = glyph.inputSchema.safeParse(body.input)
      if (!parsed.success) {
        return c.json({ error: 'Validation failed', issues: parsed.error.issues }, 400)
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
