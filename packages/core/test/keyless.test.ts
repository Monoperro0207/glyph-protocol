import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { GlyphCard } from '@glyphp/types'
import {
  computeGlyphId,
  generateKeyPair,
  type KeylessBackend,
  type KeylessBundle,
  KeylessVerifier,
  keylessSubjectDigest,
  signGlyph,
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

// Producer flow per RFC-0007 §3.1: bind the bundle to the attestation-
// exclusive id, attach the attestation, then compute the final id (which
// includes it).
function cardWithBundle(bundle: Partial<KeylessBundle>): GlyphCard {
  const full: KeylessBundle = {
    bundleVersion: 'glyph-keyless-v1',
    subjectDigest: keylessSubjectDigest(baseCard),
    issuer: 'https://token.actions.githubusercontent.com',
    identity: 'repo:acme/tools:ref:refs/tags/v1.2.0',
    ...bundle,
  }
  const attestation = {
    type: 'glyph-keyless-v1',
    payload: Buffer.from(JSON.stringify(full)).toString('base64'),
  }
  return {
    ...baseCard,
    id: computeGlyphId({ ...baseCard, attestation }),
    createdAt: '2026-05-22T00:00:00.000Z',
    attestation,
  } as GlyphCard
}

// ---------------------------------------------------------------------------
// KeylessVerifier — structural binding + identity policy; crypto is delegated
// ---------------------------------------------------------------------------

test('keyless: a well-bound bundle without a backend is valid but not trusted', async () => {
  const result = await new KeylessVerifier().verify(cardWithBundle({}))
  assert.equal(result.valid, true) // structure + subject binding ok
  assert.equal(result.trusted, false) // no backend confirmed the crypto
  assert.equal(result.type, 'glyph-keyless-v1')
})

test('keyless: a bundle whose subjectDigest does not match the card is invalid', async () => {
  const card = cardWithBundle({ subjectDigest: 'deadbeef'.repeat(8) })
  const result = await new KeylessVerifier().verify(card)
  assert.equal(result.valid, false)
  assert.match(result.error ?? '', /subject/i)
})

test('keyless: a malformed payload is invalid', async () => {
  const card = {
    ...baseCard,
    id: computeGlyphId(baseCard),
    createdAt: '',
    attestation: { type: 'glyph-keyless-v1', payload: 'not-base64-json!!!' },
  } as GlyphCard
  const result = await new KeylessVerifier().verify(card)
  assert.equal(result.valid, false)
})

test('keyless: a non-keyless attestation is rejected by this verifier', async () => {
  const card = {
    ...baseCard,
    id: computeGlyphId(baseCard),
    createdAt: '',
    attestation: { type: 'sigstore-bundle', payload: 'x' },
  } as GlyphCard
  const result = await new KeylessVerifier().verify(card)
  assert.equal(result.valid, false)
})

test('keyless: an injected backend that confirms the crypto yields trusted', async () => {
  const backend: KeylessBackend = {
    async verifyBundle() {
      return { trusted: true }
    },
  }
  const result = await new KeylessVerifier({ backend }).verify(cardWithBundle({}))
  assert.equal(result.valid, true)
  assert.equal(result.trusted, true)
})

test('keyless: an injected backend that rejects yields untrusted with an error', async () => {
  const backend: KeylessBackend = {
    async verifyBundle() {
      return { trusted: false, error: 'log entry not found' }
    },
  }
  const result = await new KeylessVerifier({ backend }).verify(cardWithBundle({}))
  assert.equal(result.valid, true)
  assert.equal(result.trusted, false)
  assert.match(result.error ?? '', /log entry/)
})

test('keyless: identity policy gates trust even when the backend confirms crypto', async () => {
  const backend: KeylessBackend = {
    async verifyBundle() {
      return { trusted: true }
    },
  }
  const card = cardWithBundle({ identity: 'repo:evil/tools:ref:refs/heads/main' })
  const verifier = new KeylessVerifier({
    backend,
    policy: { identities: ['repo:acme/tools'] },
  })
  const result = await verifier.verify(card)
  assert.equal(result.valid, true)
  assert.equal(result.trusted, false) // crypto ok, but identity outside policy
})

test('keyless: identity policy prefix match allows a trusted identity', async () => {
  const backend: KeylessBackend = {
    async verifyBundle() {
      return { trusted: true }
    },
  }
  const verifier = new KeylessVerifier({
    backend,
    policy: {
      issuers: ['https://token.actions.githubusercontent.com'],
      identities: ['repo:acme/tools'],
    },
  })
  const result = await verifier.verify(cardWithBundle({}))
  assert.equal(result.trusted, true)
})

test('keyless: a prefix without a segment boundary does NOT authorize (tools-evil)', async () => {
  const backend: KeylessBackend = {
    async verifyBundle() {
      return { trusted: true }
    },
  }
  const verifier = new KeylessVerifier({
    backend,
    policy: { identities: ['repo:acme/tools'] },
  })
  for (const identity of [
    'repo:acme/tools-evil:ref:refs/heads/main',
    'repo:acme/toolsX:ref:refs/heads/main',
    'repo:acme/tools.bak',
  ]) {
    const result = await verifier.verify(cardWithBundle({ identity }))
    assert.equal(result.valid, true, identity)
    assert.equal(result.trusted, false, `must not authorize ${identity}`)
  }
})

test('keyless: a prefix at a segment boundary still authorizes', async () => {
  const backend: KeylessBackend = {
    async verifyBundle() {
      return { trusted: true }
    },
  }
  const verifier = new KeylessVerifier({
    backend,
    policy: { identities: ['repo:acme/tools'] },
  })
  for (const identity of [
    'repo:acme/tools', // exact
    'repo:acme/tools:ref:refs/heads/main', // ':' boundary
    'repo:acme/tools/sub', // '/' boundary
  ]) {
    const result = await verifier.verify(cardWithBundle({ identity }))
    assert.equal(result.trusted, true, `must authorize ${identity}`)
  }
})

test('keyless: an allow entry ending in a delimiter matches as a namespace prefix', async () => {
  const backend: KeylessBackend = {
    async verifyBundle() {
      return { trusted: true }
    },
  }
  const verifier = new KeylessVerifier({
    backend,
    policy: { identities: ['repo:acme/'] },
  })
  const ok = await verifier.verify(cardWithBundle({ identity: 'repo:acme/anything' }))
  assert.equal(ok.trusted, true)
  const evil = await verifier.verify(cardWithBundle({ identity: 'repo:acmeX/anything' }))
  assert.equal(evil.trusted, false)
})

test('keyless: subjectDigest is invariant to attaching the attestation', () => {
  const before = keylessSubjectDigest(baseCard)
  const attested = {
    ...baseCard,
    attestation: { type: 'glyph-keyless-v1', payload: 'irrelevant' },
  }
  assert.equal(keylessSubjectDigest(attested), before)
})

test('keyless: equals sha256(card.id) only for a card without an attestation', () => {
  const card = cardWithBundle({})
  // The attested card's final id includes the attestation, so it differs
  // from the pre-attestation id the bundle commits to.
  assert.notEqual(card.id, computeGlyphId(baseCard))
})

test('keyless: a key-signed + keyless-attested card passes verifyGlyph AND subject binding', async () => {
  const attested = cardWithBundle({})
  const { publicKey, privateKey } = generateKeyPair()
  const card: GlyphCard = { ...attested, publicKey }
  card.signature = signGlyph(card, privateKey)

  // Belt-and-suspenders (RFC-0007 §3.2): both verifications hold at once.
  assert.equal(verifyGlyph(card), true)
  const result = await new KeylessVerifier().verify(card)
  assert.equal(result.valid, true)
})

test('keyless: binding is recomputed from content, not read from card.id', async () => {
  // A tampered id does not fool the binding (it commits to content); the
  // id's own integrity is verifyGlyph's check, not the keyless verifier's.
  const card = { ...cardWithBundle({}), id: 'tampered' } as GlyphCard
  const result = await new KeylessVerifier().verify(card)
  assert.equal(result.valid, true)
  assert.equal(verifyGlyph({ ...card, publicKey: 'aa', signature: 'bb' } as GlyphCard), false)
})

test('keyless: a bundle bound to different content fails on this card', async () => {
  const otherDigest = keylessSubjectDigest({ ...baseCard, name: 'other-tool' })
  const result = await new KeylessVerifier().verify(cardWithBundle({ subjectDigest: otherDigest }))
  assert.equal(result.valid, false)
  assert.match(result.error ?? '', /subject/i)
})

test('keyless: an issuer outside the policy is not trusted', async () => {
  const backend: KeylessBackend = {
    async verifyBundle() {
      return { trusted: true }
    },
  }
  const verifier = new KeylessVerifier({ backend, policy: { issuers: ['https://gitlab.com'] } })
  const result = await verifier.verify(cardWithBundle({}))
  assert.equal(result.trusted, false)
})
