import assert from 'node:assert/strict'
import { test } from 'node:test'
import { computeGlyphId, generateKeyPair, signGlyph } from '@glyphp/core'
import type { GlyphCard } from '@glyphp/types'
import {
  GlyphClient,
  GlyphNotApprovedError,
  GlyphRevokedError,
  GlyphVerificationError,
  MemoryPinStore,
} from '../src/index.js'

type GlyphKeyPair = { publicKey: string; privateKey: string }

/** Builds a fully signed card. Vary intent/riskTier/keyPair to model updates. */
function makeCard(
  opts: { intent?: string; riskTier?: 'safe' | 'caution' | 'danger'; keyPair?: GlyphKeyPair } = {},
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

/** A fetch impl that serves one card and answers calls for it. */
function serve(card: GlyphCard): typeof fetch {
  return async (input) => {
    const url = (input as Request).url
    const json = (data: unknown): Response =>
      new Response(JSON.stringify(data), {
        headers: { 'content-type': 'application/json' },
      })
    if (url.endsWith('/call')) {
      return json({
        type: 'data',
        glyphId: card.id,
        callId: 'c1',
        payload: { ok: true },
        meta: { latencyMs: 1, provider: card.provider, timestamp: '' },
      })
    }
    if (url.endsWith(`/glyphs/${encodeURIComponent(card.name)}`)) {
      return json(card)
    }
    return new Response('not found', { status: 404 })
  }
}

test('call() runs an approved, unchanged tool', async () => {
  const card = makeCard()
  const client = new GlyphClient({
    baseUrl: 'http://glyph',
    fetch: serve(card),
    pins: new MemoryPinStore(),
  })
  await client.approveCard(await client.getCard(card.name))
  const envelope = await client.call(card.name, {})
  assert.deepEqual(envelope.payload, { ok: true })
})

test('call() blocks a tool that was never approved', async () => {
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

test('call() blocks a tool after a breaking schema change', async () => {
  const pins = new MemoryPinStore()
  const keyPair = generateKeyPair()
  const v1 = makeCard({ keyPair })
  const c1 = new GlyphClient({ baseUrl: 'http://glyph', fetch: serve(v1), pins })
  await c1.approveCard(await c1.getCard(v1.name))

  // Same name, same key, but input schema changed → breaking diff → must block.
  const v2 = { ...makeCard({ keyPair }), input: { type: 'object', properties: { amount: { type: 'number' } }, required: ['amount'] } as any }
  v2.id = computeGlyphId(v2)
  v2.signature = signGlyph(v2, keyPair.privateKey)

  const c2 = new GlyphClient({ baseUrl: 'http://glyph', fetch: serve(v2), pins })
  await assert.rejects(() => c2.call(v2.name, {}), GlyphNotApprovedError)
})

test('call() blocks a provider key swap even when the card id is unchanged', async () => {
  const pins = new MemoryPinStore()
  const v1 = makeCard({ keyPair: generateKeyPair() })
  const c1 = new GlyphClient({ baseUrl: 'http://glyph', fetch: serve(v1), pins })
  await c1.approveCard(await c1.getCard(v1.name))

  // Identical content, different signing key: the id matches, the key does not.
  const v2 = makeCard({ keyPair: generateKeyPair() })
  assert.equal(v1.id, v2.id) // sanity — the id deliberately excludes publicKey
  const c2 = new GlyphClient({ baseUrl: 'http://glyph', fetch: serve(v2), pins })
  await assert.rejects(
    () => c2.call(v2.name, {}),
    (e: unknown) =>
      e instanceof GlyphNotApprovedError && e.status === 'changed' && e.diff?.keyChanged === true,
  )
})

test('call() blocks a tool that escalated from safe to danger', async () => {
  const pins = new MemoryPinStore()
  // Same provider key — the only trigger is the riskTier escalation.
  const keyPair = generateKeyPair()
  const safe = makeCard({ riskTier: 'safe', keyPair })
  const c1 = new GlyphClient({ baseUrl: 'http://glyph', fetch: serve(safe), pins })
  await c1.approveCard(await c1.getCard(safe.name))

  const danger = makeCard({ riskTier: 'danger', keyPair })
  const c2 = new GlyphClient({ baseUrl: 'http://glyph', fetch: serve(danger), pins })
  await assert.rejects(
    () => c2.call(danger.name, {}),
    (e: unknown) => {
      if (!(e instanceof GlyphNotApprovedError)) return false
      const risk = e.diff?.changes.find((c) => c.field === 'cost.riskTier')
      return risk?.severity === 'breaking' && e.diff?.requiresApproval === true
    },
  )
})

test('getCard() rejects a card with an invalid signature', async () => {
  const card = makeCard()
  // Mutate content after signing — id/signature are now stale.
  const tampered: GlyphCard = { ...card, intent: 'a different intent' }
  const client = new GlyphClient({
    baseUrl: 'http://glyph',
    fetch: serve(tampered),
  })
  await assert.rejects(
    () => client.getCard(card.name),
    (e: unknown) => e instanceof GlyphVerificationError,
  )
})

test('without a PinStore, call() runs any tool (backwards compatible)', async () => {
  const card = makeCard()
  const client = new GlyphClient({ baseUrl: 'http://glyph', fetch: serve(card) })
  const envelope = await client.call(card.name, {})
  assert.deepEqual(envelope.payload, { ok: true })
})

test('revokeTool blocks call() with GlyphRevokedError', async () => {
  const card = makeCard()
  const client = new GlyphClient({
    baseUrl: 'http://glyph',
    fetch: serve(card),
    pins: new MemoryPinStore(),
  })
  await client.approveCard(await client.getCard(card.name))
  await client.revokeTool(card.name, 'compromised provider')
  await assert.rejects(
    () => client.call(card.name, {}),
    (e: unknown) =>
      e instanceof GlyphRevokedError &&
      e.toolName === card.name &&
      e.reason === 'compromised provider',
  )
})

test('a revoked tool is reinstated only with an explicit flag', async () => {
  const card = makeCard()
  const client = new GlyphClient({
    baseUrl: 'http://glyph',
    fetch: serve(card),
    pins: new MemoryPinStore(),
  })
  await client.approveCard(await client.getCard(card.name))
  await client.revokeTool(card.name)
  // A plain re-approval must not silently clear a revocation.
  await assert.rejects(
    () => client.approveCard(card),
    (e: unknown) => e instanceof GlyphRevokedError,
  )
  // The explicit flag clears it; the tool runs again.
  await client.approveCard(card, { reinstate: true })
  const envelope = await client.call(card.name, {})
  assert.deepEqual(envelope.payload, { ok: true })
})

test('revokeTool throws for a tool that has no pin', async () => {
  const client = new GlyphClient({
    baseUrl: 'http://glyph',
    fetch: serve(makeCard()),
    pins: new MemoryPinStore(),
  })
  await assert.rejects(() => client.revokeTool('never-seen'), /nothing to revoke/)
})

test('inspectLexicon reports a revoked tool', async () => {
  const card = makeCard()
  const client = new GlyphClient({
    baseUrl: 'http://glyph',
    fetch: serve(card),
    pins: new MemoryPinStore(),
  })
  await client.approveCard(card)
  await client.revokeTool(card.name)
  const report = await client.inspectLexicon([
    {
      id: card.id,
      name: card.name,
      intent: card.intent,
      tags: card.tags,
      riskTier: 'safe',
    },
  ])
  assert.equal(report[0].status, 'revoked')
})

test('inspectLexicon flags new, unchanged and changed tools', async () => {
  const card = makeCard()
  const client = new GlyphClient({
    baseUrl: 'http://glyph',
    fetch: serve(card),
    pins: new MemoryPinStore(),
  })
  await client.approveCard(card)
  const report = await client.inspectLexicon([
    // Same id as the pinned card → unchanged.
    { id: card.id, name: card.name, intent: card.intent, tags: card.tags, riskTier: 'safe' },
    // Unknown name → new.
    { id: 'x', name: 'other-tool', intent: '', tags: [], riskTier: 'safe' },
    // Pinned name, stale id → changed.
    { id: 'stale-id', name: card.name, intent: card.intent, tags: card.tags, riskTier: 'safe' },
  ])
  assert.equal(report[0].status, 'unchanged')
  assert.equal(report[1].status, 'new')
  assert.equal(report[2].status, 'changed')
})

test('call() auto-approves non-breaking changes and blocks breaking ones', async () => {
  // Approve a card, then evolve it with a non-breaking change (intent rewording).
  // The client should auto-update the pin and execute without throwing.
  const keyPair = generateKeyPair()
  const pins = new MemoryPinStore()
  const original = makeCard({ keyPair, intent: 'Refund a payment', riskTier: 'safe' })
  const client = new GlyphClient({
    baseUrl: 'http://glyph',
    fetch: serve(original),
    pins,
  })
  await client.approveCard(original)

  // Non-breaking change: intent rewording only → should auto-approve.
  const intentReworded = makeCard({ keyPair, intent: 'Process a payment refund', riskTier: 'safe' })
  const autoClient = new GlyphClient({
    baseUrl: 'http://glyph',
    fetch: serve(intentReworded),
    pins,
  })
  // call() should succeed — non-breaking change, pin auto-updated.
  const result = await autoClient.call(intentReworded.name, {})
  assert.ok(result.payload !== undefined, 'non-breaking change should auto-approve')

  // Breaking change: risk escalation safe → danger → must still block.
  const escalated = makeCard({ keyPair, riskTier: 'danger' })
  const blockClient = new GlyphClient({
    baseUrl: 'http://glyph',
    fetch: serve(escalated),
    pins,
  })
  await assert.rejects(
    () => blockClient.call(escalated.name, {}),
    GlyphNotApprovedError,
  )
})
