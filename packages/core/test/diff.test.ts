import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeGlyphId, diffCards, generateKeyPair, signGlyph } from '../src/index.js'
import type { GlyphCard } from '@glyphp/types'

const basePartial = {
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

function sign(
  partial: Omit<GlyphCard, 'id' | 'signature' | 'createdAt' | 'publicKey'>,
  keyPair = generateKeyPair()
): GlyphCard {
  const card: GlyphCard = {
    ...partial,
    id: computeGlyphId(partial),
    createdAt: '2026-05-22T00:00:00.000Z',
    publicKey: keyPair.publicKey,
  }
  card.signature = signGlyph(card, keyPair.privateKey)
  return card
}

test('diffCards reports no change for identical cards', () => {
  const a = sign(basePartial)
  const diff = diffCards(a, a)
  assert.equal(diff.changed, false)
  assert.equal(diff.idChanged, false)
  assert.equal(diff.keyChanged, false)
  assert.equal(diff.requiresApproval, false)
  assert.equal(diff.changes.length, 0)
})

test('diffCards classifies an intent change as review-only', () => {
  const kp = generateKeyPair()
  const a = sign(basePartial, kp)
  const b = sign({ ...basePartial, intent: 'Refund a payment and notify' }, kp)
  const diff = diffCards(a, b)
  assert.equal(diff.changed, true)
  assert.equal(diff.idChanged, true)
  assert.equal(diff.requiresApproval, false)
  assert.deepEqual(
    diff.changes.map((c) => c.field),
    ['intent']
  )
  assert.equal(diff.changes[0].severity, 'review')
})

test('diffCards classifies a riskTier escalation as breaking', () => {
  const kp = generateKeyPair()
  const a = sign(basePartial, kp)
  const b = sign(
    { ...basePartial, cost: { ...basePartial.cost, riskTier: 'danger' } },
    kp
  )
  const diff = diffCards(a, b)
  assert.equal(diff.requiresApproval, true)
  const change = diff.changes.find((c) => c.field === 'cost.riskTier')
  assert.equal(change?.severity, 'breaking')
  assert.equal(change?.before, 'safe')
  assert.equal(change?.after, 'danger')
})

test('diffCards detects a key swap that leaves the id unchanged', () => {
  const a = sign(basePartial)
  // Identical content, different signing key — the protocol id excludes
  // publicKey, so the id is the same but the provenance has changed.
  const b: GlyphCard = { ...a, publicKey: generateKeyPair().publicKey }
  const diff = diffCards(a, b)
  assert.equal(diff.idChanged, false)
  assert.equal(diff.keyChanged, true)
  assert.equal(diff.requiresApproval, true)
  assert.deepEqual(
    diff.changes.map((c) => c.field),
    ['publicKey']
  )
})

test('diffCards flags an input schema change as breaking', () => {
  const kp = generateKeyPair()
  const a = sign(basePartial, kp)
  const b = sign(
    {
      ...basePartial,
      input: { type: 'object', properties: { amount: { type: 'number' } } },
    },
    kp
  )
  const diff = diffCards(a, b)
  const change = diff.changes.find((c) => c.field === 'input')
  assert.equal(change?.severity, 'breaking')
  assert.equal(diff.requiresApproval, true)
})
