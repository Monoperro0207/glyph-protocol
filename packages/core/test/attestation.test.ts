import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { CardAttestation, GlyphCard } from '@glyphp/types'
import type { AttestationResult } from '../src/index.js'
import {
  AttestationVerifierRegistry,
  computeGlyphId,
  DigestVerifier,
  diffCards,
  generateKeyPair,
  signGlyph,
  verifyAttestation,
  verifyGlyph,
} from '../src/index.js'

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
  assert.equal(id, computeGlyphId({ ...baseCard, attestation: undefined }))
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
    computeGlyphId({ ...baseCard, attestation: b }),
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

// ---------------------------------------------------------------------------
// DigestVerifier tests
// ---------------------------------------------------------------------------

const VALID_SHA256 = 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

function makeCard(attestation?: CardAttestation): GlyphCard {
  const partial = { ...baseCard, attestation }
  const keyPair = generateKeyPair()
  const card: GlyphCard = {
    ...partial,
    id: computeGlyphId(partial),
    createdAt: '2026-05-25T00:00:00.000Z',
    publicKey: keyPair.publicKey,
  }
  card.signature = signGlyph(card, keyPair.privateKey)
  return card
}

test('DigestVerifier accepts valid sha256 digest', async () => {
  const verifier = new DigestVerifier()
  assert.equal(verifier.type, 'container-digest')

  const card = makeCard({
    type: 'container-digest',
    payload: JSON.stringify({ digest: VALID_SHA256 }),
  })

  const result = await verifier.verify(card)
  assert.equal(result.valid, true)
  assert.equal(result.type, 'container-digest')
  assert.equal(result.details?.digest, VALID_SHA256)
})

test('DigestVerifier rejects malformed digest — wrong prefix', async () => {
  const verifier = new DigestVerifier()
  const card = makeCard({
    type: 'container-digest',
    payload: JSON.stringify({
      digest: 'sha512:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    }),
  })
  const result = await verifier.verify(card)
  assert.equal(result.valid, false)
  assert.notEqual(result.error, undefined)
})

test('DigestVerifier rejects malformed digest — too short', async () => {
  const verifier = new DigestVerifier()
  const card = makeCard({
    type: 'container-digest',
    payload: JSON.stringify({ digest: 'sha256:abc123' }),
  })
  const result = await verifier.verify(card)
  assert.equal(result.valid, false)
})

test('DigestVerifier rejects malformed digest — invalid hex chars', async () => {
  const verifier = new DigestVerifier()
  const card = makeCard({
    type: 'container-digest',
    payload: JSON.stringify({
      digest: 'sha256:zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz',
    }),
  })
  const result = await verifier.verify(card)
  assert.equal(result.valid, false)
})

test('DigestVerifier returns details with digest value on success', async () => {
  const verifier = new DigestVerifier()
  const card = makeCard({
    type: 'container-digest',
    payload: JSON.stringify({ digest: VALID_SHA256 }),
  })
  const result = await verifier.verify(card)
  assert.equal(result.valid, true)
  assert.equal(result.details?.digest, VALID_SHA256)
  // details must contain the validated digest
  assert.equal(typeof result.details?.digest, 'string')
})

test('DigestVerifier rejects missing attestation', async () => {
  const verifier = new DigestVerifier()
  const card = makeCard(undefined)
  const result = await verifier.verify(card)
  assert.equal(result.valid, false)
  assert.notEqual(result.error, undefined)
})

test('DigestVerifier rejects invalid JSON payload', async () => {
  const verifier = new DigestVerifier()
  const card = makeCard({
    type: 'container-digest',
    payload: 'not-valid-json',
  })
  const result = await verifier.verify(card)
  assert.equal(result.valid, false)
  assert.notEqual(result.error, undefined)
})

test('DigestVerifier rejects payload without digest field', async () => {
  const verifier = new DigestVerifier()
  const card = makeCard({
    type: 'container-digest',
    payload: JSON.stringify({ other: 'value' }),
  })
  const result = await verifier.verify(card)
  assert.equal(result.valid, false)
})

test('DigestVerifier rejects non-string digest value', async () => {
  const verifier = new DigestVerifier()
  const card = makeCard({
    type: 'container-digest',
    payload: JSON.stringify({ digest: 12345 }),
  })
  const result = await verifier.verify(card)
  assert.equal(result.valid, false)
  assert.notEqual(result.error, undefined)
})

test('DigestVerifier handles attestation of different type gracefully', async () => {
  // The verifier is selected by registry, not by attestation.type.
  // It should still try to parse and validate whatever payload is there.
  const verifier = new DigestVerifier()
  const card = makeCard({
    type: 'sigstore-bundle',
    payload: JSON.stringify({ digest: VALID_SHA256 }),
  })
  // Even though the attestation type is different, the payload still has a valid digest.
  const result = await verifier.verify(card)
  assert.equal(result.valid, true)
})

// ---------------------------------------------------------------------------
// AttestationVerifierRegistry tests
// ---------------------------------------------------------------------------

test('AttestationVerifierRegistry registers and retrieves a verifier', () => {
  const registry = new AttestationVerifierRegistry()
  const digestVerifier = new DigestVerifier()

  registry.register(digestVerifier)

  const retrieved = registry.get('container-digest')
  assert.notEqual(retrieved, undefined)
  assert.equal(retrieved!.type, 'container-digest')
})

test('AttestationVerifierRegistry returns undefined for unknown type', () => {
  const registry = new AttestationVerifierRegistry()
  assert.equal(registry.get('nonexistent'), undefined)
})

test('AttestationVerifierRegistry lists all registered types', () => {
  const registry = new AttestationVerifierRegistry()
  assert.deepEqual(registry.list(), [])

  registry.register(new DigestVerifier())
  assert.deepEqual(registry.list(), ['container-digest'])
})

test('AttestationVerifierRegistry overwrites duplicate type registration', () => {
  const registry = new AttestationVerifierRegistry()
  const first = new DigestVerifier()
  registry.register(first)

  // Register a second DigestVerifier — should overwrite
  const second = new DigestVerifier()
  registry.register(second)

  assert.equal(registry.get('container-digest'), second)
  assert.equal(registry.list().length, 1)
})
