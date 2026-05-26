import assert from 'node:assert/strict'
import { test } from 'node:test'
import { canonicalHash, computeGlyphId, generateKeyPair, signGlyph, signReceipt } from '@glyphp/core'
import type { CallReceipt, GlyphCard } from '@glyphp/types'
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

// ---------------------------------------------------------------------------
// P0-4: secureMode strict enforcement
// ---------------------------------------------------------------------------

test('secureMode: intent metadata change requires approval (no auto-approve)', async () => {
  const keyPair = generateKeyPair()
  const pins = new MemoryPinStore()
  const original = makeCard({ keyPair, intent: 'Refund a payment', riskTier: 'safe' })
  const client = new GlyphClient({
    baseUrl: 'http://glyph',
    fetch: serve(original),
    pins,
    secureMode: true,
  })
  await client.approveCard(original)

  // Same key, different intent — in secureMode this must NOT auto-approve.
  const intentChanged = makeCard({ keyPair, intent: 'Process a payment refund', riskTier: 'safe' })
  const smClient = new GlyphClient({
    baseUrl: 'http://glyph',
    fetch: serve(intentChanged),
    pins,
    secureMode: true,
  })
  await assert.rejects(
    () => smClient.call(intentChanged.name, {}),
    (e: unknown) =>
      e instanceof GlyphNotApprovedError && e.status === 'changed',
  )
})

test('secureMode: examples metadata change requires approval (no auto-approve)', async () => {
  const keyPair = generateKeyPair()
  const pins = new MemoryPinStore()

  // Build a card with non-empty examples.
  const origPartial = {
    version: '1.0.0',
    name: 'refund-payment',
    intent: 'Refund a payment',
    tags: ['billing'],
    cost: {
      latency: 'fast' as const,
      sideEffects: true,
      reversible: false,
      riskTier: 'safe' as const,
      requiresConfirmation: false,
    },
    idempotent: false,
    input: { type: 'object' },
    output: { type: 'object' },
    examples: [{ description: 'Happy path', input: {}, output: { ok: true } }],
    failureModes: [],
    provider: 'acme.payments',
  }
  const original: GlyphCard = {
    ...origPartial,
    id: computeGlyphId(origPartial),
    createdAt: '2026-05-22T00:00:00.000Z',
    publicKey: keyPair.publicKey,
  }
  original.signature = signGlyph(original, keyPair.privateKey)

  const pins2 = new MemoryPinStore()
  const client = new GlyphClient({
    baseUrl: 'http://glyph',
    fetch: serve(original),
    pins: pins2,
    secureMode: true,
  })
  await client.approveCard(original)

  // Change examples — review-only field, but secureMode blocks auto-approve.
  const exChanged = {
    ...origPartial,
    examples: [{ description: 'Sad path edge case', input: { reason: 'fraud' }, output: { ok: false } }],
  }
  const exChangedCard: GlyphCard = {
    ...exChanged,
    id: computeGlyphId(exChanged),
    createdAt: '2026-05-22T00:00:00.000Z',
    publicKey: keyPair.publicKey,
  }
  exChangedCard.signature = signGlyph(exChangedCard, keyPair.privateKey)

  const smClient = new GlyphClient({
    baseUrl: 'http://glyph',
    fetch: serve(exChangedCard),
    pins: pins2,
    secureMode: true,
  })
  await assert.rejects(
    () => smClient.call(exChangedCard.name, {}),
    (e: unknown) =>
      e instanceof GlyphNotApprovedError && e.status === 'changed',
  )
})

test('secureMode + autoApproveReviewChanges: intent change auto-approves', async () => {
  const keyPair = generateKeyPair()
  const pins = new MemoryPinStore()
  const original = makeCard({ keyPair, intent: 'Refund a payment', riskTier: 'safe' })
  const client = new GlyphClient({
    baseUrl: 'http://glyph',
    fetch: serve(original),
    pins,
    secureMode: true,
    autoApproveReviewChanges: true,
  })
  await client.approveCard(original)

  // With autoApproveReviewChanges, review-only changes auto-approve again.
  const intentChanged = makeCard({ keyPair, intent: 'Process a payment refund', riskTier: 'safe' })
  const smClient = new GlyphClient({
    baseUrl: 'http://glyph',
    fetch: serve(intentChanged),
    pins,
    secureMode: true,
    autoApproveReviewChanges: true,
  })
  const result = await smClient.call(intentChanged.name, {})
  assert.ok(result.payload !== undefined, 'with autoApproveReviewChanges, intent change should auto-approve')
})

test('secureMode: provider change still requires approval (breaking field)', async () => {
  const keyPair = generateKeyPair()
  const pins = new MemoryPinStore()
  const original = makeCard({ keyPair, riskTier: 'safe' })
  const client = new GlyphClient({
    baseUrl: 'http://glyph',
    fetch: serve(original),
    pins,
    secureMode: true,
  })
  await client.approveCard(original)

  // Provider change is a breaking field regardless of mode.
  const provChanged = { ...makeCard({ keyPair, riskTier: 'safe' }), provider: 'other.provider' }
  provChanged.id = computeGlyphId(provChanged)
  provChanged.signature = signGlyph(provChanged, keyPair.privateKey)

  const smClient = new GlyphClient({
    baseUrl: 'http://glyph',
    fetch: serve(provChanged),
    pins,
    secureMode: true,
  })
  await assert.rejects(
    () => smClient.call(provChanged.name, {}),
    (e: unknown) =>
      e instanceof GlyphNotApprovedError && e.status === 'changed' && e.diff?.requiresApproval === true,
  )
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

// ---------------------------------------------------------------------------
// Receipt-enabled mock server — returns a signed receipt in the envelope.
// ---------------------------------------------------------------------------

function serveWithReceipt(
  card: GlyphCard,
  keyPair: { publicKey: string; privateKey: string },
  overrides?: Partial<CallReceipt>,
): typeof fetch {
  return async (input) => {
    const url = (input as Request).url
    const json = (data: unknown): Response =>
      new Response(JSON.stringify(data), {
        headers: { 'content-type': 'application/json' },
      })
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
        ...overrides,
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
    if (url.endsWith(`/glyphs/${encodeURIComponent(card.name)}`)) {
      return json(card)
    }
    return new Response('not found', { status: 404 })
  }
}

// ---------------------------------------------------------------------------
// P0-5: Auto receipt verification
// ---------------------------------------------------------------------------

test('secureMode: receipt with altered payload rejects', async () => {
  const keyPair = generateKeyPair()
  const pins = new MemoryPinStore()
  const card = makeCard({ keyPair })
  const client = new GlyphClient({
    baseUrl: 'http://glyph',
    fetch: serveWithReceipt(card, keyPair),
    pins,
    secureMode: true,
  })
  await client.approveCard(card)

  // Tamper the outputHash in the receipt so it doesn't match the payload.
  const wrongHash = canonicalHash({ tampered: true })
  const tamperFetcher = serveWithReceipt(card, keyPair, { outputHash: wrongHash })
  const tamperClient = new GlyphClient({
    baseUrl: 'http://glyph',
    fetch: tamperFetcher,
    pins,
    secureMode: true,
  })
  await assert.rejects(
    () => tamperClient.call(card.name, {}),
    /receipt/i,
  )
})

test('secureMode: receipt signed by wrong key rejects', async () => {
  const keyPair = generateKeyPair()
  const wrongKeyPair = generateKeyPair()
  const pins = new MemoryPinStore()
  const card = makeCard({ keyPair })
  const client = new GlyphClient({
    baseUrl: 'http://glyph',
    fetch: serveWithReceipt(card, keyPair),
    pins,
    secureMode: true,
  })
  await client.approveCard(card)

  // Build a receipt signed by a different key — the serverPublicKey won't
  // match the card's pinned publicKey.
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
    serverPublicKey: wrongKeyPair.publicKey,
  }
  const badReceipt: CallReceipt = {
    ...receiptBase,
    signature: signReceipt(receiptBase, wrongKeyPair.privateKey),
  }
  // A fetch that returns the bad receipt.
  const badFetch: typeof fetch = async (input) => {
    const url = (input as Request).url
    const json = (data: unknown): Response =>
      new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } })
    if (url.endsWith('/call')) {
      return json({
        type: 'data',
        glyphId: card.id,
        callId: 'c1',
        payload,
        meta: { latencyMs: 1, provider: card.provider, timestamp: '' },
        inspection,
        receipt: badReceipt,
      })
    }
    if (url.endsWith(`/glyphs/${encodeURIComponent(card.name)}`)) return json(card)
    return new Response('not found', { status: 404 })
  }
  const badClient = new GlyphClient({
    baseUrl: 'http://glyph',
    fetch: badFetch,
    pins,
    secureMode: true,
  })
  await assert.rejects(
    () => badClient.call(card.name, {}),
    /receipt/i,
  )
})

test('secureMode: altered inspection rejected', async () => {
  const keyPair = generateKeyPair()
  const pins = new MemoryPinStore()
  const card = makeCard({ keyPair })
  const client = new GlyphClient({
    baseUrl: 'http://glyph',
    fetch: serveWithReceipt(card, keyPair),
    pins,
    secureMode: true,
  })
  await client.approveCard(card)

  // Tamper the inspectionHash so it doesn't match the actual inspection.
  const wrongHash = canonicalHash({ modified: true, findings: [] })
  const tamperFetcher = serveWithReceipt(card, keyPair, { inspectionHash: wrongHash })
  const tamperClient = new GlyphClient({
    baseUrl: 'http://glyph',
    fetch: tamperFetcher,
    pins,
    secureMode: true,
  })
  await assert.rejects(
    () => tamperClient.call(card.name, {}),
    /receipt/i,
  )
})

test('secureMode: glyphId mismatch rejected', async () => {
  const keyPair = generateKeyPair()
  const pins = new MemoryPinStore()
  const card = makeCard({ keyPair })
  const client = new GlyphClient({
    baseUrl: 'http://glyph',
    fetch: serveWithReceipt(card, keyPair),
    pins,
    secureMode: true,
  })
  await client.approveCard(card)

  // Tamper the glyphId so it doesn't match the approved card.
  const tamperFetcher = serveWithReceipt(card, keyPair, { glyphId: 'wrong-id' })
  const tamperClient = new GlyphClient({
    baseUrl: 'http://glyph',
    fetch: tamperFetcher,
    pins,
    secureMode: true,
  })
  await assert.rejects(
    () => tamperClient.call(card.name, {}),
    /receipt/i,
  )
})

test('verifyReceipts: false skips receipt verification', async () => {
  const keyPair = generateKeyPair()
  const pins = new MemoryPinStore()
  const card = makeCard({ keyPair })
  const client = new GlyphClient({
    baseUrl: 'http://glyph',
    fetch: serveWithReceipt(card, keyPair),
    pins,
    secureMode: true,
    verifyReceipts: false,
  })
  await client.approveCard(card)

  // Even with a tampered outputHash, verifyReceipts: false skips the check.
  const wrongHash = canonicalHash({ tampered: true })
  const tamperFetcher = serveWithReceipt(card, keyPair, { outputHash: wrongHash })
  const tamperClient = new GlyphClient({
    baseUrl: 'http://glyph',
    fetch: tamperFetcher,
    pins,
    secureMode: true,
    verifyReceipts: false,
  })
  const result = await tamperClient.call(card.name, {})
  assert.ok(result.payload !== undefined, 'verifyReceipts: false should skip verification')
})
