import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  canonicalHash,
  computeGlyphId,
  generateKeyPair,
  signGlyph,
  signReceipt,
} from '@glyphp/core'
import type { CallReceipt, GlyphCard } from '@glyphp/types'
import { GlyphClient, GlyphNotApprovedError, MemoryPinStore } from '../src/index.js'

type GlyphKeyPair = { publicKey: string; privateKey: string }

function makeCard(): { card: GlyphCard; keyPair: GlyphKeyPair } {
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
  return { card, keyPair }
}

/** Serves one card and answers calls with a receipt signed by its key. */
function serve(card: GlyphCard, keyPair: GlyphKeyPair): typeof fetch {
  return (async (input: Request | string | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const json = (data: unknown): Response =>
      new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } })
    if (url.endsWith('/call')) {
      const payload = { ok: true }
      const inspection = { modified: false, findings: [] as const }
      const { callId: clientCallId } = (await (input as Request).json()) as { callId?: string }
      const receiptBase: Omit<CallReceipt, 'signature'> = {
        receiptVersion: '0.3',
        callId: 'c1',
        ...(clientCallId ? { clientCallId } : {}),
        glyphId: card.id,
        glyphName: card.name,
        inputHash: canonicalHash({}),
        outputHash: canonicalHash(payload),
        inspectionHash: canonicalHash(inspection),
        riskTier: card.cost.riskTier,
        provider: card.provider,
        latencyMs: 1,
        timestamp: new Date().toISOString(),
        serverPublicKey: keyPair.publicKey,
      }
      return json({
        type: 'data',
        glyphId: card.id,
        callId: 'c1',
        payload,
        meta: { latencyMs: 1, provider: card.provider, timestamp: '' },
        inspection,
        receipt: { ...receiptBase, signature: signReceipt(receiptBase, keyPair.privateKey) },
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
  const { card, keyPair } = makeCard()
  const client = GlyphClient.production({
    baseUrl: 'http://glyph',
    fetch: serve(card, keyPair),
    pins: new MemoryPinStore(),
  })
  await assert.rejects(
    () => client.call(card.name, {}),
    (e: unknown) => e instanceof GlyphNotApprovedError,
  )
})

test('production() runs an approved tool normally', async () => {
  const { card, keyPair } = makeCard()
  const client = GlyphClient.production({
    baseUrl: 'http://glyph',
    fetch: serve(card, keyPair),
    pins: new MemoryPinStore(),
  })
  await client.approveCard(await client.getCard(card.name))
  const envelope = await client.call(card.name, {})
  assert.deepEqual(envelope.payload, { ok: true })
})

test('caller options override the hardened defaults (tofu:true wins over the default of false)', async () => {
  const { card, keyPair } = makeCard()
  const client = GlyphClient.production({
    baseUrl: 'http://glyph',
    fetch: serve(card, keyPair),
    pins: new MemoryPinStore(),
    tofu: true, // explicit opt-in wins over production()'s tofu:false default
  })
  // With the default tofu:false a never-seen tool would throw; the override
  // makes the first call trust-on-first-use instead.
  const envelope = await client.call(card.name, {})
  assert.deepEqual(envelope.payload, { ok: true })
})
