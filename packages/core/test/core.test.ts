import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  computeGlyphId,
  generateKeyPair,
  signGlyph,
  verifyGlyph,
  signReceipt,
  verifyReceipt,
  canonicalHash,
  toLexiconEntry,
  applyDepth,
  sealResult,
} from '../src/index.js'
import type { CallReceipt, GlyphCard } from '@glyphp/types'

const partial = {
  version: '1.0.0',
  name: 'test-glyph',
  intent: 'A glyph for testing',
  tags: ['test'],
  cost: {
    latency: 'fast',
    sideEffects: false,
    reversible: true,
    riskTier: 'safe',
    requiresConfirmation: false,
  },
  idempotent: true,
  input: { type: 'object' },
  output: { type: 'object' },
  examples: [],
  failureModes: [],
  provider: 'test.provider',
} satisfies Omit<GlyphCard, 'id' | 'signature' | 'createdAt' | 'publicKey'>

function buildCard(): GlyphCard {
  const keyPair = generateKeyPair()
  const id = computeGlyphId(partial)
  const card: GlyphCard = { ...partial, id, createdAt: new Date().toISOString() }
  card.publicKey = keyPair.publicKey
  card.signature = signGlyph(card, keyPair.privateKey)
  return card
}

test('computeGlyphId is deterministic', () => {
  assert.equal(computeGlyphId(partial), computeGlyphId(partial))
})

test('computeGlyphId changes when top-level content changes', () => {
  assert.notEqual(
    computeGlyphId(partial),
    computeGlyphId({ ...partial, intent: 'a different intent' })
  )
})

test('computeGlyphId captures nested content (cost, schemas)', () => {
  const tampered = {
    ...partial,
    cost: { ...partial.cost, riskTier: 'danger' as const },
  }
  assert.notEqual(computeGlyphId(partial), computeGlyphId(tampered))
})

test('computeGlyphId ignores key order in nested objects', () => {
  const reordered = {
    ...partial,
    cost: {
      requiresConfirmation: false,
      riskTier: 'safe' as const,
      reversible: true,
      sideEffects: false,
      latency: 'fast' as const,
    },
  }
  assert.equal(computeGlyphId(partial), computeGlyphId(reordered))
})

test('computeGlyphId returns a 64-char hex sha256', () => {
  assert.match(computeGlyphId(partial), /^[0-9a-f]{64}$/)
})

test('generateKeyPair produces distinct 32-byte hex ed25519 keys', () => {
  const a = generateKeyPair()
  const b = generateKeyPair()
  assert.match(a.publicKey, /^[0-9a-f]{64}$/)
  assert.match(a.privateKey, /^[0-9a-f]{64}$/)
  assert.notEqual(a.privateKey, b.privateKey)
})

test('signGlyph + verifyGlyph roundtrip succeeds', () => {
  assert.equal(verifyGlyph(buildCard()), true)
})

test('verifyGlyph fails when the content is tampered after signing', () => {
  const card = buildCard()
  card.provider = 'evil.provider'
  assert.equal(verifyGlyph(card), false)
})

test('verifyGlyph fails when the public key is swapped', () => {
  const card = buildCard()
  card.publicKey = generateKeyPair().publicKey
  assert.equal(verifyGlyph(card), false)
})

test('verifyGlyph fails when the signature is missing', () => {
  const card = buildCard()
  delete card.signature
  assert.equal(verifyGlyph(card), false)
})

test('verifyGlyph fails when the public key is missing', () => {
  const card = buildCard()
  delete card.publicKey
  assert.equal(verifyGlyph(card), false)
})

test('toLexiconEntry keeps only the small lexicon fields', () => {
  const entry = toLexiconEntry(buildCard())
  assert.deepEqual(Object.keys(entry).sort(), [
    'id',
    'intent',
    'name',
    'riskTier',
    'tags',
  ])
  assert.equal(entry.riskTier, 'safe')
})

test('applyDepth minimal omits cost and examples', () => {
  const out = applyDepth(buildCard(), 'minimal')
  assert.equal(out.cost, undefined)
  assert.equal(out.examples, undefined)
  assert.ok(out.input)
})

test('applyDepth standard includes cost and at most 2 examples', () => {
  const card = buildCard()
  card.examples = [
    { description: 'a', input: {}, output: {} },
    { description: 'b', input: {}, output: {} },
    { description: 'c', input: {}, output: {} },
  ]
  const out = applyDepth(card, 'standard')
  assert.ok(out.cost)
  assert.equal(out.examples?.length, 2)
})

test('applyDepth rich returns the full card', () => {
  const card = buildCard()
  assert.deepEqual(applyDepth(card, 'rich'), card)
})

test('sealResult always produces an inert data envelope', () => {
  const env = sealResult('glyph-id', 'call-id', { ok: true }, 5, 'p')
  assert.equal(env.type, 'data')
  assert.equal(env.glyphId, 'glyph-id')
  assert.equal(env.callId, 'call-id')
  assert.deepEqual(env.payload, { ok: true })
})

test('sealResult generates a callId when none is given', () => {
  const env = sealResult('g', '', null, 0, 'p')
  assert.match(env.callId, /^[0-9a-f-]{36}$/)
})

test('canonicalHash is deterministic and ignores key order', () => {
  assert.equal(canonicalHash({ a: 1, b: 2 }), canonicalHash({ b: 2, a: 1 }))
  assert.notEqual(canonicalHash({ a: 1 }), canonicalHash({ a: 2 }))
})

function buildReceipt(): CallReceipt {
  const keyPair = generateKeyPair()
  const base: Omit<CallReceipt, 'signature'> = {
    receiptVersion: '0.1',
    callId: 'call-1',
    glyphId: 'glyph-1',
    glyphName: 'test-glyph',
    inputHash: canonicalHash({ q: 'hi' }),
    outputHash: canonicalHash({ ok: true }),
    riskTier: 'safe',
    provider: 'test',
    latencyMs: 5,
    timestamp: new Date().toISOString(),
    serverPublicKey: keyPair.publicKey,
  }
  return { ...base, signature: signReceipt(base, keyPair.privateKey) }
}

test('signReceipt + verifyReceipt roundtrip succeeds', () => {
  assert.equal(verifyReceipt(buildReceipt()), true)
})

test('verifyReceipt fails when the receipt is tampered', () => {
  const receipt = buildReceipt()
  receipt.outputHash = canonicalHash({ ok: false })
  assert.equal(verifyReceipt(receipt), false)
})

test('verifyReceipt fails when the public key is swapped', () => {
  const receipt = buildReceipt()
  receipt.serverPublicKey = generateKeyPair().publicKey
  assert.equal(verifyReceipt(receipt), false)
})
