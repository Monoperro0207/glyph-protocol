import assert from 'node:assert/strict'
import { test } from 'node:test'
import { generateKeyPair, signProvidersRegistry } from '@glyphp/core'
import type { PublicProvidersRegistry } from '@glyphp/types'
import { GlyphClient, GlyphVerificationError, MemoryPinStore } from '../src/index.js'

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
        publicKey: 'aa'.repeat(32),
        status: 'active',
      },
    ],
    signedBy: { name: 'moderators', publicKey: keyPair.publicKey, fingerprint: 'fp' },
  }
  return { ...base, signature: signProvidersRegistry(base, keyPair.privateKey) }
}

function serveRegistry(registry: PublicProvidersRegistry): typeof fetch {
  return async () =>
    new Response(JSON.stringify(registry), { headers: { 'content-type': 'application/json' } })
}

test('discoverProviders returns the registry when signature + trustRoot match', async () => {
  const kp = generateKeyPair()
  const registry = makeRegistry(kp)
  const client = new GlyphClient({ baseUrl: 'http://x', fetch: serveRegistry(registry) })
  const got = await client.discoverProviders('https://registry.example/glyph.json', {
    trustRoot: kp.publicKey,
  })
  assert.equal(got.providers[0]?.name, 'billing.example')
})

test('discoverProviders rejects a registry signed by an untrusted root', async () => {
  const kp = generateKeyPair()
  const attacker = generateKeyPair()
  const registry = makeRegistry(kp)
  const client = new GlyphClient({ baseUrl: 'http://x', fetch: serveRegistry(registry) })
  await assert.rejects(
    () =>
      client.discoverProviders('https://registry.example/glyph.json', {
        trustRoot: attacker.publicKey,
      }),
    (e: unknown) => e instanceof GlyphVerificationError,
  )
})

test('discoverProviders rejects a tampered registry', async () => {
  const kp = generateKeyPair()
  const registry = makeRegistry(kp)
  const tampered: PublicProvidersRegistry = {
    ...registry,
    providers: [{ ...registry.providers[0]!, endpoint: 'https://evil.example/glyph' }],
  }
  const client = new GlyphClient({ baseUrl: 'http://x', fetch: serveRegistry(tampered) })
  await assert.rejects(
    () =>
      client.discoverProviders('https://registry.example/glyph.json', { trustRoot: kp.publicKey }),
    (e: unknown) => e instanceof GlyphVerificationError,
  )
})

test('discoverProviders never auto-approves a glyph (pin store stays empty)', async () => {
  const kp = generateKeyPair()
  const registry = makeRegistry(kp)
  const pins = new MemoryPinStore()
  const client = new GlyphClient({ baseUrl: 'http://x', fetch: serveRegistry(registry), pins })
  await client.discoverProviders('https://registry.example/glyph.json', { trustRoot: kp.publicKey })
  // The directory recommends providers; it does not pin or approve any of them.
  assert.equal(await pins.get('billing.example'), undefined)
})
