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
import {
  GlyphClient,
  GlyphNotApprovedError,
  MemoryPendingAuditQueue,
  MemoryPinStore,
} from '../src/index.js'

type GlyphKeyPair = { publicKey: string; privateKey: string }

/** Builds a fully signed card. Vary fields to model a tool update. */
function makeCard(
  opts: {
    intent?: string
    riskTier?: 'safe' | 'caution' | 'danger'
    keyPair?: GlyphKeyPair
    input?: Record<string, unknown>
  } = {},
): GlyphCard {
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
      riskTier: opts.riskTier ?? 'safe',
      requiresConfirmation: false,
    },
    idempotent: false,
    input: opts.input ?? { type: 'object' },
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

/** A fetch impl that serves one card and answers calls for it. */
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

/** A breaking v2: same key, but the input schema gained a required field. */
function breakingV2(keyPair: GlyphKeyPair): GlyphCard {
  return makeCard({
    keyPair,
    input: { type: 'object', properties: { amount: { type: 'number' } }, required: ['amount'] },
  })
}

// ---------------------------------------------------------------------------
// resilientUpdates: fail-to-last-known-good instead of fail-closed
// ---------------------------------------------------------------------------

test('resilientUpdates: a breaking change does not throw — call runs and the new card is queued', async () => {
  const keyPair = generateKeyPair()
  const pins = new MemoryPinStore()
  const v1 = makeCard({ keyPair })
  const c1 = new GlyphClient({ baseUrl: 'http://glyph', fetch: serve(v1), pins })
  await c1.approveCard(await c1.getCard(v1.name))

  const v2 = breakingV2(keyPair)
  const queue = new MemoryPendingAuditQueue()
  const client = new GlyphClient({
    baseUrl: 'http://glyph',
    fetch: serve(v2),
    pins,
    resilientUpdates: true,
    pendingAuditQueue: queue,
  })

  // The workflow is NOT broken: call() resolves rather than throwing.
  const envelope = await client.call(v2.name, {})
  assert.deepEqual(envelope.payload, { ok: true })

  // The unaudited card is parked in the queue with its breaking diff.
  const pending = await client.pendingAudits()
  assert.equal(pending.length, 1)
  assert.equal(pending[0].toolName, v2.name)
  assert.equal(pending[0].newCard.id, v2.id)
  assert.equal(pending[0].diff.requiresApproval, true)
})

test('resilientUpdates: the stable pin is NOT mutated to the new card', async () => {
  const keyPair = generateKeyPair()
  const pins = new MemoryPinStore()
  const v1 = makeCard({ keyPair })
  const c1 = new GlyphClient({ baseUrl: 'http://glyph', fetch: serve(v1), pins })
  await c1.approveCard(await c1.getCard(v1.name))

  const v2 = breakingV2(keyPair)
  const client = new GlyphClient({
    baseUrl: 'http://glyph',
    fetch: serve(v2),
    pins,
    resilientUpdates: true,
  })
  await client.call(v2.name, {})

  // The pin still points at the audited, stable v1 — never the new card.
  const pin = await pins.get(v1.name)
  assert.equal(pin?.card.id, v1.id)
  assert.notEqual(v1.id, v2.id)
})

test('resilientUpdates: onPendingAudit fires once with the diff', async () => {
  const keyPair = generateKeyPair()
  const pins = new MemoryPinStore()
  const v1 = makeCard({ keyPair })
  const c1 = new GlyphClient({ baseUrl: 'http://glyph', fetch: serve(v1), pins })
  await c1.approveCard(await c1.getCard(v1.name))

  const seen: string[] = []
  const v2 = breakingV2(keyPair)
  const client = new GlyphClient({
    baseUrl: 'http://glyph',
    fetch: serve(v2),
    pins,
    resilientUpdates: true,
    onPendingAudit: (entry) => seen.push(entry.toolName),
  })
  await client.call(v2.name, {})

  assert.deepEqual(seen, [v2.name])
})

test('resilientUpdates off (default): a breaking change still throws (regression zero)', async () => {
  const keyPair = generateKeyPair()
  const pins = new MemoryPinStore()
  const v1 = makeCard({ keyPair })
  const c1 = new GlyphClient({ baseUrl: 'http://glyph', fetch: serve(v1), pins })
  await c1.approveCard(await c1.getCard(v1.name))

  const v2 = breakingV2(keyPair)
  const client = new GlyphClient({ baseUrl: 'http://glyph', fetch: serve(v2), pins })
  await assert.rejects(() => client.call(v2.name, {}), GlyphNotApprovedError)
})

test('resilientUpdates: a never-pinned tool still throws — no stable version to fall back to', async () => {
  const v1 = makeCard()
  const client = new GlyphClient({
    baseUrl: 'http://glyph',
    fetch: serve(v1),
    pins: new MemoryPinStore(),
    resilientUpdates: true,
  })
  await assert.rejects(
    () => client.call(v1.name, {}),
    (e: unknown) => e instanceof GlyphNotApprovedError && e.status === 'new',
  )
})

// ---------------------------------------------------------------------------
// Invariant: the unaudited card's output is never accepted under secureMode.
// ---------------------------------------------------------------------------

function serveWithReceipt(card: GlyphCard, keyPair: GlyphKeyPair): typeof fetch {
  return async (input) => {
    const url = (input as Request).url
    const json = (data: unknown): Response =>
      new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } })
    if (url.endsWith('/call')) {
      const payload = { ok: true }
      const inspection = { modified: false, findings: [] as const }
      const receiptBase: Omit<CallReceipt, 'signature'> = {
        receiptVersion: '0.3',
        callId: 'c1',
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
      const receipt: CallReceipt = {
        ...receiptBase,
        signature: signReceipt(receiptBase, keyPair.privateKey),
      }
      return json({
        type: 'data',
        glyphId: card.id,
        callId: 'c1',
        payload,
        meta: { latencyMs: 1, provider: card.provider, timestamp: '' },
        inspection,
        receipt,
      })
    }
    if (url.endsWith(`/glyphs/${encodeURIComponent(card.name)}`)) return json(card)
    return new Response('not found', { status: 404 })
  }
}

test('resilientUpdates + secureMode: output of an actually-swapped card is rejected by the receipt check', async () => {
  const keyPair = generateKeyPair()
  const pins = new MemoryPinStore()
  const v1 = makeCard({ keyPair })
  const c1 = new GlyphClient({
    baseUrl: 'http://glyph',
    fetch: serveWithReceipt(v1, keyPair),
    pins,
    secureMode: true,
  })
  await c1.approveCard(v1)

  // The server has genuinely swapped to v2 and signs receipts for v2's id.
  // The receipt must be checked against the stable pin (v1), so the swapped
  // output is rejected — the unaudited card's result never reaches the caller.
  const v2 = breakingV2(keyPair)
  const client = new GlyphClient({
    baseUrl: 'http://glyph',
    fetch: serveWithReceipt(v2, keyPair),
    pins,
    secureMode: true,
    resilientUpdates: true,
  })
  await assert.rejects(() => client.call(v2.name, {}), /receipt/i)
})
