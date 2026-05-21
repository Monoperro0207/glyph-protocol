import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  computeGlyphId,
  signGlyph,
  verifyGlyph,
  toLexiconEntry,
  applyDepth,
  sealResult,
} from '../src/index.js'
import type { GlyphCard } from '@glyph/types'

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
} satisfies Omit<GlyphCard, 'id' | 'signature' | 'createdAt'>

function buildCard(): GlyphCard {
  const id = computeGlyphId(partial)
  const card: GlyphCard = { ...partial, id, createdAt: new Date().toISOString() }
  card.signature = signGlyph(card)
  return card
}

test('computeGlyphId is deterministic', () => {
  assert.equal(computeGlyphId(partial), computeGlyphId(partial))
})

test('computeGlyphId changes when content changes', () => {
  assert.notEqual(
    computeGlyphId(partial),
    computeGlyphId({ ...partial, intent: 'a different intent' })
  )
})

test('computeGlyphId returns a 64-char hex sha256', () => {
  assert.match(computeGlyphId(partial), /^[0-9a-f]{64}$/)
})

test('signGlyph + verifyGlyph roundtrip succeeds', () => {
  assert.equal(verifyGlyph(buildCard()), true)
})

test('verifyGlyph fails when the provider is tampered', () => {
  const card = buildCard()
  card.provider = 'evil.provider'
  assert.equal(verifyGlyph(card), false)
})

test('verifyGlyph fails when the signature is missing', () => {
  const card = buildCard()
  delete card.signature
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
