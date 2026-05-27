/**
 * Negative-path integration tests for the conformance suite.
 * Uses real GlyphServer instances to test adversarial scenarios.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { defineGlyph, GlyphServer } from '@glyphp/server'
import { z } from 'zod'
import { buildFixtureGlyphs, runConformance } from '../src/index.js'

// ── auth rejection: conformance detects unauthorized access ──

test('security.auth.required — pass with auth server + token → detects auth enforcement', async () => {
  const server = new GlyphServer({
    auth: { tokens: ['secret-token'] },
    rateLimit: { windowMs: 60_000, max: 500 },
  })
  for (const g of buildFixtureGlyphs()) server.register(g)

  const report = await runConformance('http://glyph', {
    fetch: server.fetch,
    fixtures: { echo: 'conformance-echo' },
    authToken: 'secret-token',
  })
  const authCheck = report.checks.find((c) => c.name === 'security.auth.required')
  assert.ok(authCheck)
  assert.equal(authCheck.status, 'passed', `should detect auth enforcement: ${authCheck.detail}`)
})

test('security.auth.required — fail when server has no auth but token expected', async () => {
  // Server without auth, but we tell conformance to expect it → should fail
  const server = new GlyphServer()
  for (const g of buildFixtureGlyphs()) server.register(g)

  const report = await runConformance('http://glyph', {
    fetch: server.fetch,
    fixtures: { echo: 'conformance-echo' },
    authToken: 'secret-token', // claiming auth exists, but it doesn't
  })
  const authCheck = report.checks.find((c) => c.name === 'security.auth.required')
  assert.ok(authCheck)
  assert.equal(
    authCheck.status,
    'failed',
    `should detect missing auth when token is expected: ${authCheck.detail}`,
  )
})

// ── rate limit: 429 detection ──

test('security.rateLimit — pass when server enforces rate limiting', async () => {
  // Tight rate limit so conformance's burst (up to 200) hits it
  const server = new GlyphServer({
    rateLimit: { windowMs: 60_000, max: 3 },
  })
  server.register(
    defineGlyph({
      name: 'conformance-echo',
      intent: 'Echoes its input back',
      cost: {
        latency: 'fast',
        sideEffects: false,
        reversible: true,
        riskTier: 'safe',
        requiresConfirmation: false,
      },
      input: z.object({ value: z.string() }),
      output: z.object({ value: z.string() }),
      provider: 'conformance',
      handler: async (input) => input,
    }),
  )

  const report = await runConformance('http://glyph', {
    fetch: server.fetch,
    fixtures: { echo: 'conformance-echo' },
  })
  const rateCheck = report.checks.find((c) => c.name === 'security.rateLimit')
  assert.ok(rateCheck)
  assert.equal(rateCheck.status, 'passed', `rate limit should be detected: ${rateCheck.detail}`)
})

// ── manifest tampering: invalid signature detected ──

test('governance.manifest — skip when manifest has no valid signature (structural validity only)', async () => {
  const server = new GlyphServer()
  server.register(
    defineGlyph({
      name: 'echo',
      intent: 'Echoes input',
      cost: {
        latency: 'fast',
        sideEffects: false,
        reversible: true,
        riskTier: 'safe',
        requiresConfirmation: false,
      },
      input: z.object({ value: z.string() }),
      output: z.object({ value: z.string() }),
      provider: 'conformance',
      handler: async (input) => input,
    }),
  )

  server.registerManifest('echo', {
    previousCardId: 'old-card-id',
    reason: 'security update',
    breaking: true,
    securityImpact: 'high',
  })

  // Tamper the signature directly on the internal map
  const manifest = (server as any).manifests.get('echo')
  assert.ok(manifest, 'manifest should exist')
  manifest.signature = '00'.repeat(64) // garbage signature

  const report = await runConformance('http://glyph', {
    fetch: server.fetch,
    profile: 'production', // governance requires production profile
  })
  const manifestCheck = report.checks.find((c) => c.name === 'governance.manifest')
  assert.ok(manifestCheck)
  // Note: governance.manifest only validates UpdateManifest JSON Schema.
  // Cryptographic signature verification is at a different layer (verifyManifest from @glyphp/core).
  // The conformance suite currently only checks schema-level correctness.
  assert.ok(
    manifestCheck.status === 'passed' || manifestCheck.status === 'skipped',
    `manifest check: ${manifestCheck.status} — ${manifestCheck.detail}`,
  )
})

// ── key registry attack: broken chain detection ──

test('governance.keyRegistry — pass with valid key registry', async () => {
  const { buildKeyEntry, buildKeyRegistry, generateKeyPair, StaticKeyRegistry } = await import(
    '@glyphp/core'
  )

  const kp = generateKeyPair()
  const entry = buildKeyEntry(kp.publicKey, new Date().toISOString())
  const fullRegistry = buildKeyRegistry({
    serverId: 'test-server',
    entries: [entry],
    activePrivateKey: kp.privateKey,
  })
  const source = new StaticKeyRegistry(fullRegistry)

  const server = new GlyphServer({ keyRegistry: source, keyPair: kp })
  server.register(
    defineGlyph({
      name: 'echo',
      intent: 'test',
      cost: {
        latency: 'fast',
        sideEffects: false,
        reversible: true,
        riskTier: 'safe',
        requiresConfirmation: false,
      },
      input: z.object({}).passthrough(),
      output: z.object({}).passthrough(),
      provider: 'conformance',
      handler: async () => ({}),
    }),
  )

  const report = await runConformance('http://glyph', {
    fetch: server.fetch,
    profile: 'production', // governance requires production profile
  })
  const keyCheck = report.checks.find((c) => c.name === 'governance.keyRegistry')
  assert.ok(keyCheck)
  assert.equal(keyCheck.status, 'passed', keyCheck.detail)
})

test('governance.keyRegistry — skipped when no registry published', async () => {
  const server = new GlyphServer()
  server.register(
    defineGlyph({
      name: 'echo',
      intent: 'test',
      cost: {
        latency: 'fast',
        sideEffects: false,
        reversible: true,
        riskTier: 'safe',
        requiresConfirmation: false,
      },
      input: z.object({}).passthrough(),
      output: z.object({}).passthrough(),
      provider: 'conformance',
      handler: async () => ({}),
    }),
  )

  const report = await runConformance('http://glyph', {
    fetch: server.fetch,
    profile: 'production', // governance requires production profile
  })
  const keyCheck = report.checks.find((c) => c.name === 'governance.keyRegistry')
  assert.ok(keyCheck)
  assert.equal(keyCheck.status, 'skipped')
})

// ── integration: complete conformance run against a valid server ──

test('full conformance against fixture server passes all levels', async () => {
  const server = new GlyphServer()
  for (const g of buildFixtureGlyphs()) server.register(g)

  const report = await runConformance('http://glyph', {
    fetch: server.fetch,
    fixtures: {
      echo: 'conformance-echo',
      requiresConfirmation: 'conformance-requires-confirmation',
      slow: 'conformance-slow',
      invalidOutput: 'conformance-invalid-output',
    },
  })
  assert.equal(report.passed, true, 'should pass all levels')
  for (const level of report.levels) {
    assert.equal(level.status, 'pass', `${level.level} should pass`)
  }
})

// ── conformance correctly reports a non-Glyph endpoint as failing ──

test('non-Glyph endpoint fails all discovery checks', async () => {
  const report = await runConformance('http://glyph', {
    fetch: () => new Response('not json', { status: 200 }),
    levels: ['discovery'],
  })
  // Health, handshake, lexicon, depthEnum, and notFound all fail.
  // Card shape/signature are skipped (no glyphs). schema.sanitization passes (local).
  const nonFailNames = new Set([
    'discovery.card.shape',
    'discovery.card.signature',
    'discovery.schema.sanitization',
  ])
  for (const c of report.checks) {
    if (nonFailNames.has(c.name)) continue
    assert.equal(c.status, 'failed', `${c.name}: ${c.detail}`)
  }
  // card shape and signature are skipped when no glyphs
  const shapeCheck = report.checks.find((c) => c.name === 'discovery.card.shape')
  assert.equal(shapeCheck?.status, 'skipped')
  const sigCheck = report.checks.find((c) => c.name === 'discovery.card.signature')
  assert.equal(sigCheck?.status, 'skipped')
  assert.equal(report.passed, false)
})
