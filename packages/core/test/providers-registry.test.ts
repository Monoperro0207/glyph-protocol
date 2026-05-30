import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { PublicProvidersRegistry } from '@glyphp/types'
import { generateKeyPair, signProvidersRegistry, verifyProvidersRegistry } from '../src/index.js'

function makeRegistry(keyPair: { publicKey: string; privateKey: string }): PublicProvidersRegistry {
  const base: Omit<PublicProvidersRegistry, 'signature'> = {
    registryVersion: '1.0',
    registryId: 'community.glyph-protocol.dev',
    issuedAt: '2026-05-24T19:00:00.000Z',
    ttlSeconds: 86400,
    providers: [
      {
        name: 'billing.example',
        endpoint: 'https://billing.example.com/glyph',
        publicKey: 'f18c992289a1b940bb6aac740ca9b90452a45427c831cc4fce5d3d1a5b4d3100',
        status: 'active',
        tags: ['finance'],
      },
    ],
    signedBy: {
      name: 'Glyph community moderators',
      publicKey: keyPair.publicKey,
      fingerprint: 'fp',
    },
  }
  return { ...base, signature: signProvidersRegistry(base, keyPair.privateKey) }
}

test('providers registry: sign + verify round-trips against the signer key', () => {
  const kp = generateKeyPair()
  const registry = makeRegistry(kp)
  assert.equal(verifyProvidersRegistry(registry), true)
  assert.equal(verifyProvidersRegistry(registry, { trustRoot: kp.publicKey }), true)
})

test('providers registry: a mismatched trustRoot is rejected', () => {
  const kp = generateKeyPair()
  const other = generateKeyPair()
  const registry = makeRegistry(kp)
  assert.equal(verifyProvidersRegistry(registry, { trustRoot: other.publicKey }), false)
})

test('providers registry: a tampered registry fails verification', () => {
  const kp = generateKeyPair()
  const registry = makeRegistry(kp)
  // Mutate a provider after signing — the signature is now stale.
  const tampered: PublicProvidersRegistry = {
    ...registry,
    providers: [{ ...registry.providers[0]!, endpoint: 'https://evil.example/glyph' }],
  }
  assert.equal(verifyProvidersRegistry(tampered), false)
})

test('providers registry: an unsupported version is rejected', () => {
  const kp = generateKeyPair()
  const registry = { ...makeRegistry(kp), registryVersion: '2.0' as unknown as '1.0' }
  assert.equal(verifyProvidersRegistry(registry), false)
})
