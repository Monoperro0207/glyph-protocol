import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import type { GlyphCard } from '@glyphp/types'
import {
  computeGlyphId,
  type KeylessBackend,
  type KeylessBundle,
  KeylessVerifier,
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

function cardWithBundle(bundle: Partial<KeylessBundle>, id?: string): GlyphCard {
  const cardId = id ?? computeGlyphId(baseCard)
  const full: KeylessBundle = {
    bundleVersion: 'glyph-keyless-v1',
    subjectDigest: createHash('sha256').update(cardId).digest('hex'),
    issuer: 'https://token.actions.githubusercontent.com',
    identity: 'repo:acme/tools:ref:refs/tags/v1.2.0',
    ...bundle,
  }
  return {
    ...baseCard,
    id: cardId,
    createdAt: '2026-05-22T00:00:00.000Z',
    attestation: {
      type: 'glyph-keyless-v1',
      payload: Buffer.from(JSON.stringify(full)).toString('base64'),
    },
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
