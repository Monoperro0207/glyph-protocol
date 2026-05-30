import assert from 'node:assert/strict'
import { test } from 'node:test'
import { computeGlyphId, diffCards, generateKeyPair, signGlyph } from '@glyphp/core'
import type { CardDiff, GlyphCard } from '@glyphp/types'
import {
  type AuditDecision,
  type AuditReport,
  type AutoPromotionPolicy,
  evaluatePromotion,
  GlyphClient,
  MemoryPendingAuditQueue,
  MemoryPinStore,
} from '../src/index.js'

type GlyphKeyPair = { publicKey: string; privateKey: string }

function makeCard(
  opts: {
    keyPair?: GlyphKeyPair
    riskTier?: 'safe' | 'caution' | 'danger'
    input?: Record<string, unknown>
  } = {},
): GlyphCard {
  const keyPair = opts.keyPair ?? generateKeyPair()
  const partial = {
    version: '1.0.0',
    name: 'refund-payment',
    intent: 'Refund a payment',
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

function breakingV2(keyPair: GlyphKeyPair): GlyphCard {
  return makeCard({
    keyPair,
    input: { type: 'object', properties: { amount: { type: 'number' } }, required: ['amount'] },
  })
}

function serve(card: GlyphCard): typeof fetch {
  return async (input) => {
    const url = (input as Request).url
    const json = (data: unknown, status = 200): Response =>
      new Response(JSON.stringify(data), {
        status,
        headers: { 'content-type': 'application/json' },
      })
    if (url.endsWith('/manifest')) return json({ error: { code: 'NOT_FOUND' } }, 404)
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

function report(diff: CardDiff, over: Partial<AuditReport> = {}): AuditReport {
  return {
    toolName: 'refund-payment',
    newCardId: 'new-id',
    signatureValid: true,
    manifest: 'absent',
    attestation: 'absent',
    diff,
    ok: true,
    notes: [],
    ...over,
  }
}

// ---------------------------------------------------------------------------
// evaluatePromotion — the pure decision function
// ---------------------------------------------------------------------------

test('evaluatePromotion: conservative default {} promotes nothing breaking', () => {
  const k = generateKeyPair()
  const diff = diffCards(makeCard({ keyPair: k }), breakingV2(k))
  const { promote, reasons } = evaluatePromotion(report(diff), {})
  assert.equal(promote, false)
  assert.ok(reasons.some((r) => /breaking/.test(r)))
})

test('evaluatePromotion: allowBreaking promotes a breaking schema change when audit ok', () => {
  const k = generateKeyPair()
  const diff = diffCards(makeCard({ keyPair: k }), breakingV2(k))
  const { promote } = evaluatePromotion(report(diff), { allowBreaking: true })
  assert.equal(promote, true)
})

test('evaluatePromotion: a risk escalation needs allowRiskEscalation even with allowBreaking', () => {
  const k = generateKeyPair()
  const diff = diffCards(
    makeCard({ keyPair: k, riskTier: 'safe' }),
    makeCard({ keyPair: k, riskTier: 'danger' }),
  )
  const blocked = evaluatePromotion(report(diff), { allowBreaking: true })
  assert.equal(blocked.promote, false)
  assert.ok(blocked.reasons.some((r) => /risk escalation/.test(r)))
  const allowed = evaluatePromotion(report(diff), {
    allowBreaking: true,
    allowRiskEscalation: true,
  })
  assert.equal(allowed.promote, true)
})

test('evaluatePromotion: a key change needs allowKeyChange', () => {
  const diff = diffCards(
    makeCard({ keyPair: generateKeyPair() }),
    makeCard({ keyPair: generateKeyPair() }),
  )
  assert.equal(diff.keyChanged, true)
  assert.equal(evaluatePromotion(report(diff), { allowBreaking: true }).promote, false)
  assert.equal(
    evaluatePromotion(report(diff), { allowBreaking: true, allowKeyChange: true }).promote,
    true,
  )
})

test('evaluatePromotion: a failed audit is never promotable, whatever the policy', () => {
  const k = generateKeyPair()
  const diff = diffCards(makeCard({ keyPair: k }), breakingV2(k))
  const r = report(diff, { signatureValid: false, ok: false })
  const { promote } = evaluatePromotion(r, {
    allowBreaking: true,
    allowRiskEscalation: true,
    allowKeyChange: true,
  })
  assert.equal(promote, false)
})

test('evaluatePromotion: requireManifest blocks when the manifest is not valid', () => {
  const k = generateKeyPair()
  const diff = diffCards(makeCard({ keyPair: k }), breakingV2(k))
  const { promote, reasons } = evaluatePromotion(report(diff, { manifest: 'absent' }), {
    allowBreaking: true,
    requireManifest: true,
  })
  assert.equal(promote, false)
  assert.ok(reasons.some((r) => /manifest/.test(r)))
})

// ---------------------------------------------------------------------------
// processAudits — audit + policy-gated promotion
// ---------------------------------------------------------------------------

async function setup(policy?: AutoPromotionPolicy, newCard?: GlyphCard) {
  const keyPair = generateKeyPair()
  const v1 = makeCard({ keyPair })
  const v2 = newCard ?? breakingV2(keyPair)
  const pins = new MemoryPinStore()
  await pins.set({ toolName: v1.name, approvedAt: '', card: v1 })
  const queue = new MemoryPendingAuditQueue()
  queue.enqueue({ toolName: v2.name, newCard: v2, diff: diffCards(v1, v2), detectedAt: '' })
  const client = new GlyphClient({
    baseUrl: 'http://glyph',
    fetch: serve(v2),
    pins,
    resilientUpdates: true,
    pendingAuditQueue: queue,
    autoPromotionPolicy: policy,
  })
  return { keyPair, v1, v2, pins, queue, client }
}

test('processAudits: a permissive policy promotes a breaking update', async () => {
  const { v1, v2, pins, client } = await setup({ allowBreaking: true })
  const decisions = await client.processAudits()
  assert.equal(decisions[0].promoted, true)
  assert.equal((await pins.get(v2.name))?.card.id, v2.id)
  assert.notEqual(v1.id, v2.id)
  assert.equal((await client.pendingAudits()).length, 0)
})

test('processAudits: the conservative default promotes nothing', async () => {
  const { v1, pins, client } = await setup() // no policy
  const decisions = await client.processAudits()
  assert.equal(decisions[0].promoted, false)
  assert.equal((await pins.get(v1.name))?.card.id, v1.id) // pin unchanged
  assert.equal((await client.pendingAudits()).length, 1) // entry retained
})

test('processAudits: a tampered update is never promoted, even under a permissive policy', async () => {
  const keyPair = generateKeyPair()
  const v1 = makeCard({ keyPair })
  const v2 = breakingV2(keyPair)
  const tampered: GlyphCard = { ...v2, intent: 'a different intent' } // signature now stale
  const pins = new MemoryPinStore()
  await pins.set({ toolName: v1.name, approvedAt: '', card: v1 })
  const queue = new MemoryPendingAuditQueue()
  queue.enqueue({
    toolName: v1.name,
    newCard: tampered,
    diff: diffCards(v1, tampered),
    detectedAt: '',
  })
  const client = new GlyphClient({
    baseUrl: 'http://glyph',
    fetch: serve(v1),
    pins,
    resilientUpdates: true,
    pendingAuditQueue: queue,
    autoPromotionPolicy: { allowBreaking: true, allowRiskEscalation: true, allowKeyChange: true },
  })

  const decisions = await client.processAudits()
  assert.equal(decisions[0].promoted, false)
  assert.equal((await pins.get(v1.name))?.card.id, v1.id) // stable pin held
})

// ---------------------------------------------------------------------------
// Autonomous runner — audits and promotes behind a live workflow
// ---------------------------------------------------------------------------

test('startAuditRunner: a parked update is audited and promoted in the background', async () => {
  const keyPair = generateKeyPair()
  const v1 = makeCard({ keyPair })
  const v2 = breakingV2(keyPair)
  const pins = new MemoryPinStore()
  const c1 = new GlyphClient({ baseUrl: 'http://glyph', fetch: serve(v1), pins })
  await c1.approveCard(await c1.getCard(v1.name))

  const decisions: AuditDecision[] = []
  const client = new GlyphClient({
    baseUrl: 'http://glyph',
    fetch: serve(v2),
    pins,
    resilientUpdates: true,
    autoPromotionPolicy: { allowBreaking: true },
    onAuditComplete: (d) => decisions.push(d),
  })
  client.startAuditRunner()

  // The workflow keeps running on the stable pin — call() does not block.
  const envelope = await client.call(v2.name, {})
  assert.deepEqual(envelope.payload, { ok: true })

  // Behind it, the runner audits and promotes the update on its own.
  await client.flushAudits()
  assert.equal((await pins.get(v2.name))?.card.id, v2.id)
  assert.equal(decisions.length, 1)
  assert.equal(decisions[0].promoted, true)
  client.stopAuditRunner()
})
