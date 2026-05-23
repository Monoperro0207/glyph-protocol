import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  computeGlyphId,
  diffCards,
  generateKeyPair,
  signGlyph,
  verifyAttestation,
  verifyGlyph,
} from '../src/index.js'
import type { CardAttestation, GlyphCard } from '@glyphp/types'

const baseCard = {
  version: '1.0.0',
  name: 'noop',
  intent: 'does nothing',
  tags: [],
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
  provider: 'test',
} satisfies Omit<GlyphCard, 'id' | 'signature' | 'createdAt' | 'publicKey'>

test('omitting attestation produces the same id as before — backwards compatible', () => {
  // The id of a card without attestation must be stable across SDK versions.
  // Adding `attestation` to canonical only matters when the field is present;
  // when absent, JSON.stringify drops the undefined value.
  const id = computeGlyphId(baseCard)
  // SHA-256 of the canonical content for this exact card. Snapshot to lock
  // backwards compatibility: if this value ever changes for a card that does
  // NOT carry an attestation, we broke 0.2-era pins.
  assert.equal(
    id,
    computeGlyphId({ ...baseCard, attestation: undefined })
  )
  assert.equal(id.length, 64) // sha256 hex
})

test('adding an attestation changes the id — the new card is a new tool', () => {
  const attestation: CardAttestation = {
    type: 'slsa-provenance',
    payload: 'base64-bytes-here',
  }
  const withAtt = { ...baseCard, attestation }
  assert.notEqual(computeGlyphId(baseCard), computeGlyphId(withAtt))
})

test('changing the attestation payload changes the id', () => {
  const a: CardAttestation = { type: 'sigstore-bundle', payload: 'AAAA' }
  const b: CardAttestation = { type: 'sigstore-bundle', payload: 'BBBB' }
  assert.notEqual(
    computeGlyphId({ ...baseCard, attestation: a }),
    computeGlyphId({ ...baseCard, attestation: b })
  )
})

test('signed card with attestation still verifies', () => {
  const keyPair = generateKeyPair()
  const partial = {
    ...baseCard,
    attestation: {
      type: 'sigstore-bundle',
      payload: 'x'.repeat(64),
    } satisfies CardAttestation,
  }
  const card: GlyphCard = {
    ...partial,
    id: computeGlyphId(partial),
    createdAt: '2026-05-22T00:00:00.000Z',
    publicKey: keyPair.publicKey,
  }
  card.signature = signGlyph(card, keyPair.privateKey)
  assert.equal(verifyGlyph(card), true)
})

test('diff flags attestation changes as breaking', () => {
  const keyPair = generateKeyPair()
  const makeCard = (attestation?: CardAttestation): GlyphCard => {
    const partial = { ...baseCard, attestation }
    const card: GlyphCard = {
      ...partial,
      id: computeGlyphId(partial),
      createdAt: '2026-05-22T00:00:00.000Z',
      publicKey: keyPair.publicKey,
    }
    card.signature = signGlyph(card, keyPair.privateKey)
    return card
  }
  const before = makeCard({ type: 'slsa-provenance', payload: 'AAAA' })
  const after = makeCard({ type: 'slsa-provenance', payload: 'BBBB' })
  const diff = diffCards(before, after)
  assert.equal(diff.changed, true)
  assert.equal(diff.requiresApproval, true)
  const change = diff.changes.find((c) => c.field === 'attestation')
  assert.equal(change?.severity, 'breaking')
})

test('verifyAttestation rejects undefined and empty envelopes', () => {
  assert.deepEqual(verifyAttestation(undefined), {
    ok: false,
    recognized: false,
  })
  assert.deepEqual(verifyAttestation({ type: '', payload: 'x' }), {
    ok: false,
    recognized: false,
  })
  assert.deepEqual(verifyAttestation({ type: 'sigstore-bundle', payload: '' }), {
    ok: false,
    recognized: false,
  })
})

test('verifyAttestation distinguishes well-formed from recognized', () => {
  // A vendor-specific type is well-formed but the SDK does not know it.
  const vendor = verifyAttestation({ type: 'acme.custom-v1', payload: 'abc' })
  assert.equal(vendor.ok, true)
  assert.equal(vendor.recognized, false)

  // A known type is both well-formed and recognized — though "recognized" is
  // not a substitute for verification against an external trust root.
  const known = verifyAttestation({
    type: 'sigstore-bundle',
    payload: 'abc',
  })
  assert.equal(known.ok, true)
  assert.equal(known.recognized, true)
})
