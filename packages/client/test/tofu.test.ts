import assert from 'node:assert/strict'
import { test } from 'node:test'
import { computeGlyphId, generateKeyPair, signGlyph } from '@glyphp/core'
import type { GlyphCard } from '@glyphp/types'
import {
  GlyphClient,
  GlyphNotApprovedError,
  GlyphVerificationError,
  MemoryPinStore,
} from '../src/index.js'

type GlyphKeyPair = { publicKey: string; privateKey: string }

function makeCard(opts: { keyPair?: GlyphKeyPair; intent?: string } = {}): GlyphCard {
  const keyPair = opts.keyPair ?? generateKeyPair()
  const partial = {
    version: '1.0.0',
    name: 'refund-payment',
    intent: opts.intent ?? 'Refund a payment',
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
  return async (input) => {
    const url = (input as Request).url
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
  }
}

// ---------------------------------------------------------------------------
// TOFU — trust-on-first-use: auto-pin a new tool, then gate key swaps
// ---------------------------------------------------------------------------

test('tofu: a new tool is auto-pinned on first use and call() succeeds', async () => {
  const card = makeCard()
  const pins = new MemoryPinStore()
  const client = new GlyphClient({ baseUrl: 'http://glyph', fetch: serve(card), pins, tofu: true })

  const envelope = await client.call(card.name, {})
  assert.deepEqual(envelope.payload, { ok: true })

  // The first encounter pinned the card — no explicit approveCard() needed.
  const pin = await pins.get(card.name)
  assert.equal(pin?.card.id, card.id)
  assert.equal(pin?.card.publicKey, card.publicKey)
})

test('tofu: after first use, a key swap is still gated', async () => {
  const pins = new MemoryPinStore()
  const v1 = makeCard({ keyPair: generateKeyPair() })
  // First use pins v1's key.
  await new GlyphClient({ baseUrl: 'http://glyph', fetch: serve(v1), pins, tofu: true }).call(
    v1.name,
    {},
  )

  // Same content, different signing key — the id matches, the key does not.
  const v2 = makeCard({ keyPair: generateKeyPair() })
  assert.equal(v1.id, v2.id)
  const client = new GlyphClient({ baseUrl: 'http://glyph', fetch: serve(v2), pins, tofu: true })
  await assert.rejects(
    () => client.call(v2.name, {}),
    (e: unknown) =>
      e instanceof GlyphNotApprovedError && e.status === 'changed' && e.diff?.keyChanged === true,
  )
})

test('tofu off (default): a new tool still throws (regression zero)', async () => {
  const card = makeCard()
  const client = new GlyphClient({
    baseUrl: 'http://glyph',
    fetch: serve(card),
    pins: new MemoryPinStore(),
  })
  await assert.rejects(
    () => client.call(card.name, {}),
    (e: unknown) => e instanceof GlyphNotApprovedError && e.status === 'new',
  )
})

test('tofu: a tampered card is not auto-pinned', async () => {
  const card = makeCard()
  const tampered: GlyphCard = { ...card, intent: 'a different intent' } // signature stale
  const pins = new MemoryPinStore()
  const client = new GlyphClient({
    baseUrl: 'http://glyph',
    fetch: serve(tampered),
    pins,
    tofu: true,
  })
  // getCard() rejects the tampered card before TOFU can pin it.
  await assert.rejects(
    () => client.call(tampered.name, {}),
    (e: unknown) => e instanceof GlyphVerificationError,
  )
  assert.equal(await pins.get(card.name), undefined)
})

test('tofu: the second call runs the now-pinned tool unchanged', async () => {
  const card = makeCard()
  const pins = new MemoryPinStore()
  const client = new GlyphClient({ baseUrl: 'http://glyph', fetch: serve(card), pins, tofu: true })
  await client.call(card.name, {}) // first use pins
  const second = await client.call(card.name, {}) // unchanged → runs normally
  assert.deepEqual(second.payload, { ok: true })
})

test('tofu requires a PinStore', () => {
  assert.throws(
    () => new GlyphClient({ baseUrl: 'http://glyph', tofu: true }),
    /tofu requires a PinStore/i,
  )
})
