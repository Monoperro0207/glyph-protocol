import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { z } from 'zod'
import { defineGlyph, GlyphServer } from '../src/index.js'

const savedEnv = { NODE_ENV: process.env.NODE_ENV }

const ping = defineGlyph({
  name: 'ping',
  intent: 'A trivial glyph used to exercise server middleware',
  cost: {
    latency: 'fast',
    sideEffects: false,
    reversible: true,
    riskTier: 'safe',
    requiresConfirmation: false,
  },
  input: z.object({}),
  output: z.object({ ok: z.boolean() }),
  provider: 'test',
  handler: async () => ({ ok: true }),
})

function hardenedServer() {
  const server = new GlyphServer({
    auth: { tokens: ['valid'] },
    rateLimit: { windowMs: 60_000, max: 2 },
  })
  server.register(ping)
  return server
}

const lexicon = (token?: string) =>
  new Request('http://glyph/lexicon', {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })

test('auth and rate limiting run together: a valid token is gated by the limit', async () => {
  const server = hardenedServer()
  // No token → rejected by auth.
  assert.equal((await server.fetch(lexicon())).status, 401)
  // A verified token gets its own bucket: two pass, the third is limited.
  assert.equal((await server.fetch(lexicon('valid'))).status, 200)
  assert.equal((await server.fetch(lexicon('valid'))).status, 200)
  assert.equal((await server.fetch(lexicon('valid'))).status, 429)
})

test('rotating fake bearer tokens cannot escape the rate limit', async () => {
  const server = hardenedServer()
  // Each request carries a brand-new invalid token. The limiter must key them
  // to the shared IP bucket, not mint a fresh per-token bucket each time.
  await server.fetch(lexicon('fake-1'))
  await server.fetch(lexicon('fake-2'))
  const third = await server.fetch(lexicon('fake-3'))
  assert.equal(third.status, 429)
})

// ── Production Hardening (PRODHARDEN-001) ────────────────────────────────

function productionServer(opts: Record<string, unknown> = {}) {
  return new GlyphServer({
    auth: { tokens: ['prod-token'] },
    rateLimit: { windowMs: 60_000, max: 200 },
    keyPair: {
      publicKey: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      privateKey: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    },
    ...opts,
  })
}

test('PRODHARDEN-001: production with all configs → starts successfully', () => {
  process.env.NODE_ENV = 'production'
  try {
    const server = productionServer({ strictProduction: true })
    assert.ok(server instanceof GlyphServer)
    // The server should have been constructed without errors
    assert.ok(server.fetch)
  } finally {
    process.env.NODE_ENV = savedEnv.NODE_ENV
  }
})

test('PRODHARDEN-001: production + missing auth → throws when strictProduction true', () => {
  process.env.NODE_ENV = 'production'
  try {
    assert.throws(
      () =>
        productionServer({
          strictProduction: true,
          auth: undefined,
        }),
      /auth/,
    )
  } finally {
    process.env.NODE_ENV = savedEnv.NODE_ENV
  }
})

test('PRODHARDEN-001: production + missing rateLimit → throws when strictProduction true', () => {
  process.env.NODE_ENV = 'production'
  try {
    assert.throws(
      () =>
        productionServer({
          strictProduction: true,
          rateLimit: undefined,
        }),
      /rateLimit/,
    )
  } finally {
    process.env.NODE_ENV = savedEnv.NODE_ENV
  }
})

test('PRODHARDEN-001: production + missing keyPair and signer → throws when strictProduction true', () => {
  process.env.NODE_ENV = 'production'
  try {
    assert.throws(
      () =>
        productionServer({
          strictProduction: true,
          keyPair: undefined,
        }),
      /keyPair|signer/,
    )
  } finally {
    process.env.NODE_ENV = savedEnv.NODE_ENV
  }
})

test('PRODHARDEN-001: production + strictProduction false → warns but starts with missing configs', () => {
  process.env.NODE_ENV = 'production'
  try {
    const server = productionServer({
      strictProduction: false,
      auth: undefined,
      rateLimit: undefined,
    })
    assert.ok(server instanceof GlyphServer)
    assert.ok(server.fetch)
  } finally {
    process.env.NODE_ENV = savedEnv.NODE_ENV
  }
})

test('PRODHARDEN-001: non-production env → no checks, current behavior preserved', () => {
  delete process.env.NODE_ENV
  try {
    // No keyPair, no auth, no rateLimit — should work in dev
    const server = new GlyphServer()
    assert.ok(server instanceof GlyphServer)
    assert.ok(server.fetch)
  } finally {
    process.env.NODE_ENV = savedEnv.NODE_ENV
  }
})

test('PRODHARDEN-001: production error message names the missing configs', () => {
  process.env.NODE_ENV = 'production'
  try {
    assert.throws(
      () =>
        new GlyphServer({
          strictProduction: true,
          keyPair: {
            publicKey: 'aa'.repeat(32),
            privateKey: 'bb'.repeat(32),
          },
        }),
      (err: Error) => err.message.includes('auth') && err.message.includes('rateLimit'),
    )
  } finally {
    process.env.NODE_ENV = savedEnv.NODE_ENV
  }
})

test('PRODHARDEN-001: production with custom signer instead of keyPair → accepted', () => {
  process.env.NODE_ENV = 'production'
  try {
    // A signer satisfies the key stability requirement without a keyPair
    const signer = {
      publicKey: 'cc'.repeat(32),
      signGlyphSync: () => 'sig',
      signReceipt: async () => 'sig',
      signManifestSync: () => 'sig',
    }
    const server = new GlyphServer({
      strictProduction: true,
      signer: signer as any,
      auth: { tokens: ['t'] },
      rateLimit: { windowMs: 60_000, max: 10 },
    })
    assert.ok(server instanceof GlyphServer)
    assert.ok(server.fetch)
  } finally {
    process.env.NODE_ENV = savedEnv.NODE_ENV
  }
})
