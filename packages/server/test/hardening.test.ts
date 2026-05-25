import assert from 'node:assert/strict'
import { test } from 'node:test'
import { z } from 'zod'
import { defineGlyph, GlyphServer } from '../src/index.js'

const ping = defineGlyph({
  name: 'ping',
  intent: 'A trivial glyph used to exercise server middleware',
  cost: {
    latency: 'fast',
    sideEffects: false,
    reversible: true,
    riskTier: 'safe',
    requiresConfirmation: false,
  },
  input: z.object({}),
  output: z.object({ ok: z.boolean() }),
  provider: 'test',
  handler: async () => ({ ok: true }),
})

function hardenedServer() {
  const server = new GlyphServer({
    auth: { tokens: ['valid'] },
    rateLimit: { windowMs: 60_000, max: 2 },
  })
  server.register(ping)
  return server
}

const lexicon = (token?: string) =>
  new Request('http://glyph/lexicon', {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })

test('auth and rate limiting run together: a valid token is gated by the limit', async () => {
  const server = hardenedServer()
  // No token → rejected by auth.
  assert.equal((await server.fetch(lexicon())).status, 401)
  // A verified token gets its own bucket: two pass, the third is limited.
  assert.equal((await server.fetch(lexicon('valid'))).status, 200)
  assert.equal((await server.fetch(lexicon('valid'))).status, 200)
  assert.equal((await server.fetch(lexicon('valid'))).status, 429)
})

test('rotating fake bearer tokens cannot escape the rate limit', async () => {
  const server = hardenedServer()
  // Each request carries a brand-new invalid token. The limiter must key them
  // to the shared IP bucket, not mint a fresh per-token bucket each time.
  await server.fetch(lexicon('fake-1'))
  await server.fetch(lexicon('fake-2'))
  const third = await server.fetch(lexicon('fake-3'))
  assert.equal(third.status, 429)
})
