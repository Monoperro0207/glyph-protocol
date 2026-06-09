import assert from 'node:assert/strict'
import { test } from 'node:test'
import { computeGlyphId, generateKeyPair, signGlyph } from '@glyphp/core'
import type { GlyphCard } from '@glyphp/types'
import { GlyphClient, GlyphNotApprovedError, MemoryPinStore } from '../src/index.js'

function makeCard(): GlyphCard {
  const keyPair = generateKeyPair()
  const partial = {
    version: '1.0.0',
    name: 'refund-payment',
    intent: 'Refund a payment',
    tags: ['billing'],
    cost: {
      latency: 'fast',
      sideEffects: true,
      reversible: false,
      riskTier: 'safe',
      requiresConfirmation: false,
    },
    idempotent: false,
    input: { type: 'object' },
    output: { type: 'object' },
    examples: [],
    failureModes: [],
    provider: 'acme.payments',
  } satisfies Omit<GlyphCard, 'id' | 'signature' | 'createdAt' | 'publicKey'>
  const card: GlyphCard = {
    ...partial,
    id: computeGlyphId(partial),
    createdAt: '2026-05-22T00:00:00.000Z',
    publicKey: keyPair.publicKey,
  }
  card.signature = signGlyph(card, keyPair.privateKey)
  return card
}

function serve(card: GlyphCard): typeof fetch {
  return (async (input: Request | string | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const json = (data: unknown): Response =>
      new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } })
    if (url.endsWith('/call')) {
      return json({
        type: 'data',
        glyphId: card.id,
        callId: 'c1',
        payload: { ok: true },
        meta: { latencyMs: 1, provider: card.provider, timestamp: '' },
      })
    }
    if (url.endsWith(`/glyphs/${encodeURIComponent(card.name)}`)) return json(card)
    return new Response('not found', { status: 404 })
  }) as typeof fetch
}

test('production() requires a PinStore', () => {
  assert.throws(() => GlyphClient.production({ baseUrl: 'http://glyph' }), /requires a PinStore/)
})

test('production() turns on the pin gate — an unapproved tool is refused', async () => {
  const card = makeCard()
  const client = GlyphClient.production({
    baseUrl: 'http://glyph',
    fetch: serve(card),
    pins: new MemoryPinStore(),
  })
  await assert.rejects(
    () => client.call(card.name, {}),
    (e: unknown) => e instanceof GlyphNotApprovedError,
  )
})

test('production() runs an approved tool normally', async () => {
  const card = makeCard()
  const client = GlyphClient.production({
    baseUrl: 'http://glyph',
    fetch: serve(card),
    pins: new MemoryPinStore(),
  })
  await client.approveCard(await client.getCard(card.name))
  const envelope = await client.call(card.name, {})
  assert.deepEqual(envelope.payload, { ok: true })
})

test('caller options override the hardened defaults (tofu:true wins over the default of false)', async () => {
  const card = makeCard()
  const client = GlyphClient.production({
    baseUrl: 'http://glyph',
    fetch: serve(card),
    pins: new MemoryPinStore(),
    tofu: true, // explicit opt-in wins over production()'s tofu:false default
  })
  // With the default tofu:false a never-seen tool would throw; the override
  // makes the first call trust-on-first-use instead.
  const envelope = await client.call(card.name, {})
  assert.deepEqual(envelope.payload, { ok: true })
})
