import assert from 'node:assert/strict'
import { test } from 'node:test'
import { computeGlyphId, generateKeyPair, signGlyph, signManifest } from '@glyphp/core'
import type { GlyphCard, UpdateManifest } from '@glyphp/types'
import { MANIFEST_VERSION } from '@glyphp/types'
import { GlyphClient, GlyphVerificationError, MemoryPinStore } from '../src/index.js'

type KeyPair = { publicKey: string; privateKey: string }

function makeCard(keyPair: KeyPair): GlyphCard {
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

function makeManifest(keyPair: KeyPair): UpdateManifest {
  const base: Omit<UpdateManifest, 'signature'> = {
    manifestVersion: MANIFEST_VERSION,
    toolName: 'refund-payment',
    previousCardId: 'old-id',
    newCardId: 'new-id',
    reason: 'Added pagination',
    breaking: false,
    securityImpact: 'none',
    issuedAt: '2026-05-22T00:00:00.000Z',
    serverPublicKey: keyPair.publicKey,
  }
  return { ...base, signature: signManifest(base, keyPair.privateKey) }
}

/** Serves a card and, optionally, a manifest. */
function serve(card: GlyphCard, manifest?: UpdateManifest): typeof fetch {
  return async (input) => {
    const url = (input as Request).url
    const json = (data: unknown, status = 200): Response =>
      new Response(JSON.stringify(data), {
        status,
        headers: { 'content-type': 'application/json' },
      })
    if (url.endsWith('/manifest')) {
      return manifest
        ? json(manifest)
        : json({ error: { code: 'NOT_FOUND', message: 'none' } }, 404)
    }
    if (url.endsWith(`/glyphs/${encodeURIComponent(card.name)}`)) {
      return json(card)
    }
    return new Response('not found', { status: 404 })
  }
}

test('getManifest returns a verified manifest', async () => {
  const keyPair = generateKeyPair()
  const client = new GlyphClient({
    baseUrl: 'http://glyph',
    fetch: serve(makeCard(keyPair), makeManifest(keyPair)),
  })
  const manifest = await client.getManifest('refund-payment')
  assert.equal(manifest?.reason, 'Added pagination')
})

test('getManifest returns undefined when the server publishes none', async () => {
  const client = new GlyphClient({
    baseUrl: 'http://glyph',
    fetch: serve(makeCard(generateKeyPair())),
  })
  assert.equal(await client.getManifest('refund-payment'), undefined)
})

test('getManifest rejects a manifest with an invalid signature', async () => {
  const keyPair = generateKeyPair()
  const manifest = makeManifest(keyPair)
  // Mutate content after signing — the signature is now stale.
  const tampered: UpdateManifest = { ...manifest, reason: 'something else' }
  const client = new GlyphClient({
    baseUrl: 'http://glyph',
    fetch: serve(makeCard(keyPair), tampered),
  })
  await assert.rejects(
    () => client.getManifest('refund-payment'),
    (e: unknown) => e instanceof GlyphVerificationError,
  )
})

test('getManifest rejects a manifest not signed by the pinned key', async () => {
  const pinnedKey = generateKeyPair()
  const card = makeCard(pinnedKey)
  // A self-consistent manifest — but signed by a key the consumer never approved.
  const manifest = makeManifest(generateKeyPair())
  const pins = new MemoryPinStore()
  const client = new GlyphClient({
    baseUrl: 'http://glyph',
    fetch: serve(card, manifest),
    pins,
  })
  await client.approveCard(card)
  await assert.rejects(
    () => client.getManifest('refund-payment'),
    (e: unknown) => e instanceof GlyphVerificationError,
  )
})
