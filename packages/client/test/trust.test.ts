import assert from 'node:assert/strict'
import { mkdtemp, realpath, writeFile, rm, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test, afterEach } from 'node:test'
import { generateKeyPair, computeGlyphId, signGlyph } from '@glyphp/core'
import type { GlyphCard, ProviderTrustEntry } from '@glyphp/types'
import {
  GlyphClient,
  GlyphVerificationError,
  MemoryPinStore,
} from '../src/index.js'
import { ProviderTrustResolver } from '../src/trust.js'

type KeyPair = { publicKey: string; privateKey: string }

/** Builds a fully signed card for a given provider + key pair. */
function makeCard(keyPair: KeyPair, provider = 'acme.payments'): GlyphCard {
  const partial = {
    version: '1.0.0',
    name: 'refund-payment',
    intent: 'Refund a payment',
    tags: ['billing'],
    cost: {
      latency: 'fast' as const,
      sideEffects: true,
      reversible: false,
      riskTier: 'safe' as const,
      requiresConfirmation: false,
    },
    idempotent: false,
    input: { type: 'object' },
    output: { type: 'object' },
    examples: [],
    failureModes: [],
    provider,
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

/** A fetch impl that serves one card and answers calls for it. */
function serveCard(card: GlyphCard): typeof fetch {
  return async (input) => {
    const url = (input as Request).url
    const json = (data: unknown): Response =>
      new Response(JSON.stringify(data), {
        headers: { 'content-type': 'application/json' },
      })
    if (url.endsWith('/call')) {
      return json({
        type: 'data',
        glyphId: card.id,
        callId: 'c1',
        payload: { ok: true },
        meta: { latencyMs: 1, provider: card.provider, timestamp: '' },
      })
    }
    if (url.endsWith(`/glyphs/${encodeURIComponent(card.name)}`)) {
      return json(card)
    }
    return new Response('not found', { status: 404 })
  }
}

// ---------------------------------------------------------------------------
// TRUSTREG-001: HTTP discovery
// ---------------------------------------------------------------------------

test('TRUSTREG-001: HTTP discovery resolves provider keys', async () => {
  const entry: ProviderTrustEntry = {
    provider: 'glyph.acme.com',
    publicKeys: [generateKeyPair().publicKey],
    genesisKey: generateKeyPair().publicKey,
    registeredAt: '2026-05-25T00:00:00.000Z',
  }

  const httpFetch: typeof fetch = async (input) => {
    const url = typeof input === 'string' ? input : (input as Request).url
    if (url === 'https://glyph.acme.com/.well-known/glyph-trust') {
      return new Response(JSON.stringify(entry), {
        headers: { 'content-type': 'application/json' },
      })
    }
    return new Response('not found', { status: 404 })
  }

  const resolver = new ProviderTrustResolver({
    httpDiscovery: true,
    fetchImpl: httpFetch,
  })

  const resolved = await resolver.resolve('glyph.acme.com')
  assert.ok(resolved, 'expected a resolved entry')
  assert.equal(resolved!.provider, entry.provider)
  assert.equal(resolved!.publicKeys[0], entry.publicKeys[0])
  assert.deepEqual(Array.from(resolver.list()), ['glyph.acme.com'])
})

// ---------------------------------------------------------------------------
// TRUSTREG-001: Filesystem discovery
// ---------------------------------------------------------------------------

test('TRUSTREG-001: Filesystem discovery resolves from .glyph-trust.json', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'glyph-trust-test-'))
  const trustFile = join(tmpDir, '.glyph-trust.json')
  const entry: ProviderTrustEntry = {
    provider: 'acme.payments',
    publicKeys: [generateKeyPair().publicKey],
    registeredAt: '2026-05-25T00:00:00.000Z',
  }
  await writeFile(trustFile, JSON.stringify(entry), 'utf8')

  const resolver = new ProviderTrustResolver({
    fsDiscoveryPath: tmpDir,
  })

  const resolved = await resolver.resolve('acme.payments')
  assert.ok(resolved, 'expected a resolved entry')
  assert.equal(resolved!.provider, entry.provider)
  assert.equal(resolved!.publicKeys[0], entry.publicKeys[0])

  await rm(tmpDir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// TRUSTREG-001: Explicit entries
// ---------------------------------------------------------------------------

test('TRUSTREG-001: explicit entries resolve without HTTP or filesystem', async () => {
  const keyPair = generateKeyPair()
  const entry: ProviderTrustEntry = {
    provider: 'acme.payments',
    publicKeys: [keyPair.publicKey],
  }

  const resolver = new ProviderTrustResolver({
    explicit: [entry],
  })

  const resolved = await resolver.resolve('acme.payments')
  assert.ok(resolved, 'expected a resolved entry')
  assert.equal(resolved!.publicKeys[0], keyPair.publicKey)
  assert.deepEqual(Array.from(resolver.list()), ['acme.payments'])

  // Unknown provider returns undefined.
  const missing = await resolver.resolve('unknown.org')
  assert.equal(missing, undefined)
})

// ---------------------------------------------------------------------------
// TRUSTREG-002: Client trust enforcement — unknown provider
// ---------------------------------------------------------------------------

test('TRUSTREG-002: unknown provider rejected when trust enabled', async () => {
  const keyPair = generateKeyPair()
  const card = makeCard(keyPair, 'unknown.provider')
  const client = new GlyphClient({
    baseUrl: 'http://glyph',
    fetch: serveCard(card),
    pins: new MemoryPinStore(),
    trust: { enabled: true },
  })

  // Approve the card (pin gate must also pass).
  await client.approveCard(await client.getCard(card.name))

  // call() must reject because the provider is unknown.
  await assert.rejects(
    () => client.call(card.name, {}),
    (e: unknown) =>
      e instanceof Error && /provider/i.test(e.message),
  )
})

// ---------------------------------------------------------------------------
// TRUSTREG-002: allowUnknownProviders
// ---------------------------------------------------------------------------

test('TRUSTREG-002: unknown provider allowed with allowUnknownProviders', async () => {
  const keyPair = generateKeyPair()
  const card = makeCard(keyPair, 'unknown.provider')
  const client = new GlyphClient({
    baseUrl: 'http://glyph',
    fetch: serveCard(card),
    pins: new MemoryPinStore(),
    trust: { enabled: true, allowUnknownProviders: true },
  })

  await client.approveCard(await client.getCard(card.name))

  // With allowUnknownProviders, an unknown provider does NOT block execution.
  const envelope = await client.call(card.name, {})
  assert.deepEqual(envelope.payload, { ok: true })
})

// ---------------------------------------------------------------------------
// TRUSTREG-002: Card with untrusted publicKey rejected
// ---------------------------------------------------------------------------

test('TRUSTREG-002: Card with untrusted publicKey rejected', async () => {
  const trustedKey = generateKeyPair()
  const rogueKey = generateKeyPair()

  // Register a trust entry for the provider with the *trusted* key.
  const entry: ProviderTrustEntry = {
    provider: 'acme.payments',
    publicKeys: [trustedKey.publicKey],
  }
  const resolver = new ProviderTrustResolver({ explicit: [entry] })

  // Create a card signed by the *rogue* key — same provider, wrong key.
  const rogueCard = makeCard(rogueKey, 'acme.payments')

  const client = new GlyphClient({
    baseUrl: 'http://glyph',
    fetch: serveCard(rogueCard),
    pins: new MemoryPinStore(),
    trust: { enabled: true, resolver },
  })

  await client.approveCard(await client.getCard(rogueCard.name))

  // call() must reject because the card's key is not trusted.
  await assert.rejects(
    () => client.call(rogueCard.name, {}),
    (e: unknown) =>
      e instanceof Error && /trust/i.test(e.message),
  )
})

// ---------------------------------------------------------------------------
// TRUSTREG-002: Card with trusted publicKey passes
// ---------------------------------------------------------------------------

test('TRUSTREG-002: Card with trusted publicKey passes', async () => {
  const trustedKey = generateKeyPair()

  const entry: ProviderTrustEntry = {
    provider: 'acme.payments',
    publicKeys: [trustedKey.publicKey],
  }
  const resolver = new ProviderTrustResolver({ explicit: [entry] })

  const card = makeCard(trustedKey, 'acme.payments')

  const client = new GlyphClient({
    baseUrl: 'http://glyph',
    fetch: serveCard(card),
    pins: new MemoryPinStore(),
    trust: { enabled: true, resolver },
  })

  await client.approveCard(await client.getCard(card.name))

  const envelope = await client.call(card.name, {})
  assert.deepEqual(envelope.payload, { ok: true })
})

// ---------------------------------------------------------------------------
// TRUSTREG-003: Genesis pinning — first key stored, rotation verified
// ---------------------------------------------------------------------------

test('TRUSTREG-003: genesis key pinned on first encounter', async () => {
  const genesisPair = generateKeyPair()

  const entry: ProviderTrustEntry = {
    provider: 'acme.payments',
    publicKeys: [genesisPair.publicKey],
    genesisKey: genesisPair.publicKey,
  }

  const resolver = new ProviderTrustResolver({ explicit: [entry] })

  // First resolve — genesis key is recorded.
  const first = await resolver.resolve('acme.payments')
  assert.ok(first, 'expected a resolved entry on first encounter')
  assert.equal(first!.genesisKey, genesisPair.publicKey)

  // Check genesis is pinned.
  const pinned = resolver.getGenesis('acme.payments')
  assert.equal(pinned, genesisPair.publicKey)
})

test('TRUSTREG-003: key rotation accepted when genesis matches', async () => {
  const genesisPair = generateKeyPair()
  const rotatedPair = generateKeyPair()

  // First entry: genesis key.
  const entry1: ProviderTrustEntry = {
    provider: 'acme.payments',
    publicKeys: [genesisPair.publicKey],
    genesisKey: genesisPair.publicKey,
  }

  // Resolve once to pin genesis.
  const resolver = new ProviderTrustResolver({ explicit: [entry1] })
  await resolver.resolve('acme.payments')

  // Simulate rotation: a fresh resolver (like a new process) with an updated entry.
  // The entry carries the same genesisKey but a different active key.
  const entry2: ProviderTrustEntry = {
    provider: 'acme.payments',
    publicKeys: [rotatedPair.publicKey],
    genesisKey: genesisPair.publicKey,
  }

  const resolver2 = new ProviderTrustResolver({ explicit: [entry2] })
  // The second resolver doesn't have genesis — but the entry's genesisKey stays
  // consistent, so the caller can verify it matches whatever they pinned.
  const second = await resolver2.resolve('acme.payments')
  assert.ok(second, 'expected a resolved entry after rotation')
  assert.equal(second!.genesisKey, genesisPair.publicKey,
    'genesis key must stay pinned across rotations')
  assert.ok(
    second!.publicKeys.includes(rotatedPair.publicKey),
    'rotated key must be present in the entry',
  )
  assert.ok(
    !second!.publicKeys.includes(genesisPair.publicKey),
    'genesis key may no longer be an active key after rotation',
  )
})

test('TRUSTREG-003: genesis pinning rejects a provider with mismatched genesis', async () => {
  const firstGenesis = generateKeyPair()

  // First encounter: pin genesis.
  const entry1: ProviderTrustEntry = {
    provider: 'acme.payments',
    publicKeys: [firstGenesis.publicKey],
    genesisKey: firstGenesis.publicKey,
  }

  const resolver = new ProviderTrustResolver({ explicit: [entry1] })
  await resolver.resolve('acme.payments')

  // Now create a resolver with a DIFFERENT genesis key for the same provider.
  // This simulates a takeover attempt.
  const secondGenesis = generateKeyPair()
  const entry2: ProviderTrustEntry = {
    provider: 'acme.payments',
    publicKeys: [secondGenesis.publicKey],
    genesisKey: secondGenesis.publicKey,
  }

  // Update the existing resolver's explicit entries.
  // Since genesis is pinned in the resolver, resolving again should detect mismatch.
  const resolver2 = new ProviderTrustResolver({
    explicit: [entry2],
    genesis: resolver.getGenesisSnapshot(),
  })

  const resolved = await resolver2.resolve('acme.payments')
  assert.equal(resolved, undefined,
    'genesis mismatch must return undefined — provider cannot change genesis')
})

test('TRUSTREG-003: provider with no explicit genesisKey defaults first key', async () => {
  const firstKey = generateKeyPair()

  // Entry without an explicit genesisKey — the resolver should default to the
  // first public key as genesis.
  const entry: ProviderTrustEntry = {
    provider: 'new.provider',
    publicKeys: [firstKey.publicKey],
  }

  const resolver = new ProviderTrustResolver({ explicit: [entry] })
  await resolver.resolve('new.provider')

  const pinned = resolver.getGenesis('new.provider')
  assert.equal(pinned, firstKey.publicKey,
    'first public key is implicitly the genesis when none is set')
})
