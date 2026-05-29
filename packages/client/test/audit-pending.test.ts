import assert from 'node:assert/strict'
import { test } from 'node:test'
import { computeGlyphId, diffCards, generateKeyPair, signGlyph, signManifest } from '@glyphp/core'
import type { GlyphCard, UpdateManifest } from '@glyphp/types'
import { MANIFEST_VERSION } from '@glyphp/types'
import {
  GlyphClient,
  MemoryPendingAuditQueue,
  MemoryPinStore,
  type PendingAuditEntry,
} from '../src/index.js'

type GlyphKeyPair = { publicKey: string; privateKey: string }

function makeCard(
  opts: { keyPair?: GlyphKeyPair; input?: Record<string, unknown> } = {},
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
      riskTier: 'safe',
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

function entry(v1: GlyphCard, v2: GlyphCard): PendingAuditEntry {
  return {
    toolName: v2.name,
    newCard: v2,
    diff: diffCards(v1, v2),
    detectedAt: '2026-05-22T00:00:00.000Z',
  }
}

/** Serves a card and, optionally, a manifest at /manifest. */
function serve(card: GlyphCard, manifest?: UpdateManifest): typeof fetch {
  return async (input) => {
    const url = (input as Request).url
    const json = (data: unknown, status = 200): Response =>
      new Response(JSON.stringify(data), {
        status,
        headers: { 'content-type': 'application/json' },
      })
    if (url.endsWith('/manifest')) {
      return manifest ? json(manifest) : json({ error: { code: 'NOT_FOUND' } }, 404)
    }
    if (url.endsWith(`/glyphs/${encodeURIComponent(card.name)}`)) return json(card)
    return new Response('not found', { status: 404 })
  }
}

function makeManifest(
  keyPair: GlyphKeyPair,
  fields: { toolName: string; previousCardId: string; newCardId: string; breaking?: boolean },
): UpdateManifest {
  const base: Omit<UpdateManifest, 'signature'> = {
    manifestVersion: MANIFEST_VERSION,
    toolName: fields.toolName,
    previousCardId: fields.previousCardId,
    newCardId: fields.newCardId,
    reason: 'Added a required field',
    breaking: fields.breaking ?? true,
    securityImpact: 'none',
    issuedAt: '2026-05-22T00:00:00.000Z',
    serverPublicKey: keyPair.publicKey,
  }
  return { ...base, signature: signManifest(base, keyPair.privateKey) }
}

// ---------------------------------------------------------------------------
// auditPending: re-verify parked updates. Informs, never promotes.
// ---------------------------------------------------------------------------

test('auditPending: a validly-signed update reports signatureValid and ok', async () => {
  const keyPair = generateKeyPair()
  const v1 = makeCard({ keyPair })
  const v2 = breakingV2(keyPair)
  const pins = new MemoryPinStore()
  await pins.set({ toolName: v1.name, approvedAt: '', card: v1 })
  const queue = new MemoryPendingAuditQueue()
  queue.enqueue(entry(v1, v2))

  const client = new GlyphClient({
    baseUrl: 'http://glyph',
    fetch: serve(v2),
    pins,
    resilientUpdates: true,
    pendingAuditQueue: queue,
  })

  const reports = await client.auditPending()
  assert.equal(reports.length, 1)
  assert.equal(reports[0].toolName, v2.name)
  assert.equal(reports[0].newCardId, v2.id)
  assert.equal(reports[0].signatureValid, true)
  assert.equal(reports[0].manifest, 'absent')
  assert.equal(reports[0].ok, true)
})

test('auditPending: a tampered card reports signatureValid false and ok false', async () => {
  const keyPair = generateKeyPair()
  const v1 = makeCard({ keyPair })
  const v2 = breakingV2(keyPair)
  // Tamper the content after signing — id/signature are now stale.
  const tampered: GlyphCard = { ...v2, intent: 'a different intent' }
  const pins = new MemoryPinStore()
  await pins.set({ toolName: v1.name, approvedAt: '', card: v1 })
  const queue = new MemoryPendingAuditQueue()
  queue.enqueue(entry(v1, tampered))

  const client = new GlyphClient({
    baseUrl: 'http://glyph',
    fetch: serve(v1),
    pins,
    resilientUpdates: true,
    pendingAuditQueue: queue,
  })

  const reports = await client.auditPending()
  assert.equal(reports[0].signatureValid, false)
  assert.equal(reports[0].ok, false)
})

test('auditPending: a valid signed manifest describing the update is reported valid', async () => {
  const keyPair = generateKeyPair()
  const v1 = makeCard({ keyPair })
  const v2 = breakingV2(keyPair)
  const pins = new MemoryPinStore()
  await pins.set({ toolName: v1.name, approvedAt: '', card: v1 })
  const queue = new MemoryPendingAuditQueue()
  queue.enqueue(entry(v1, v2))

  const manifest = makeManifest(keyPair, {
    toolName: v2.name,
    previousCardId: v1.id,
    newCardId: v2.id,
  })
  const client = new GlyphClient({
    baseUrl: 'http://glyph',
    fetch: serve(v2, manifest),
    pins,
    resilientUpdates: true,
    pendingAuditQueue: queue,
  })

  const reports = await client.auditPending()
  assert.equal(reports[0].manifest, 'valid')
  assert.equal(reports[0].ok, true)
})

test('auditPending: a manifest that describes a different update is reported invalid', async () => {
  const keyPair = generateKeyPair()
  const v1 = makeCard({ keyPair })
  const v2 = breakingV2(keyPair)
  const pins = new MemoryPinStore()
  await pins.set({ toolName: v1.name, approvedAt: '', card: v1 })
  const queue = new MemoryPendingAuditQueue()
  queue.enqueue(entry(v1, v2))

  // Self-consistent, pinned-key-signed manifest — but newCardId points elsewhere.
  const manifest = makeManifest(keyPair, {
    toolName: v2.name,
    previousCardId: v1.id,
    newCardId: 'some-other-card-id',
  })
  const client = new GlyphClient({
    baseUrl: 'http://glyph',
    fetch: serve(v2, manifest),
    pins,
    resilientUpdates: true,
    pendingAuditQueue: queue,
  })

  const reports = await client.auditPending()
  assert.equal(reports[0].manifest, 'invalid')
  assert.equal(reports[0].ok, false)
})

test('auditPending: does not mutate the pin or drain the queue', async () => {
  const keyPair = generateKeyPair()
  const v1 = makeCard({ keyPair })
  const v2 = breakingV2(keyPair)
  const pins = new MemoryPinStore()
  await pins.set({ toolName: v1.name, approvedAt: '', card: v1 })
  const queue = new MemoryPendingAuditQueue()
  queue.enqueue(entry(v1, v2))

  const client = new GlyphClient({
    baseUrl: 'http://glyph',
    fetch: serve(v2),
    pins,
    resilientUpdates: true,
    pendingAuditQueue: queue,
  })

  await client.auditPending()
  // The pin is untouched and the entry remains parked — auditPending only informs.
  assert.equal((await pins.get(v1.name))?.card.id, v1.id)
  assert.equal((await client.pendingAudits()).length, 1)
})
