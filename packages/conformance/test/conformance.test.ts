import { test } from 'node:test'
import assert from 'node:assert/strict'
import { z } from 'zod'
import { defineGlyph, GlyphServer } from '@glyphp/server'
import { FIXTURE_NAMES, registerFixtures, runConformance } from '../src/index.js'

const server = new GlyphServer()
server.register(
  defineGlyph({
    name: 'echo',
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
    provider: 'conformance-fixture',
    handler: async (input) => input,
  })
)

test('a spec-compliant server passes the discovery level', async () => {
  const report = await runConformance('http://glyph', {
    fetch: server.fetch,
    levels: ['discovery'],
  })
  for (const check of report.checks) {
    if (check.status === 'skipped') continue
    assert.equal(
      check.status,
      'passed',
      `${check.name}: ${check.detail}`
    )
  }
  assert.equal(report.passed, true)
  assert.ok(report.compatibility.includes('discovery'))
})

test('rate-limit burst runs last so it does not poison timeout/governance checks', async () => {
  // Repro of the 9.1/10 CEO audit H2-a: a server with a tight rate limit
  // must still see security.timeout and governance.* pass when level=all is
  // run. Before the fix, security.rateLimit drained the bucket mid-suite and
  // every subsequent check returned 429.
  const tight = new GlyphServer({
    callTimeoutMs: 100,
    rateLimit: { windowMs: 60_000, max: 100 },
  })
  registerFixtures(tight)
  const report = await runConformance('http://glyph', {
    fetch: tight.fetch,
    levels: ['discovery', 'execution', 'security', 'governance'],
    fixtures: FIXTURE_NAMES,
  })
  const byName = new Map(report.checks.map((c) => [c.name, c]))
  // The rate-limit check itself must still fire and observe a 429.
  assert.equal(
    byName.get('security.rateLimit')?.status,
    'passed',
    `security.rateLimit: ${byName.get('security.rateLimit')?.detail}`
  )
  // The checks that historically got contaminated must now pass.
  assert.equal(
    byName.get('security.timeout')?.status,
    'passed',
    `security.timeout: ${byName.get('security.timeout')?.detail}`
  )
  // governance.manifest is allowed to be skipped (no manifest published) but
  // must NOT be failed by a 429.
  assert.notEqual(
    byName.get('governance.manifest')?.status,
    'failed',
    `governance.manifest: ${byName.get('governance.manifest')?.detail}`
  )
  // No governance check is allowed to mention 429 in its detail — that would
  // mean the burst leaked into the next level.
  for (const check of report.checks.filter((c) => c.level === 'governance')) {
    assert.ok(
      !/\b429\b/.test(check.detail),
      `${check.name} was contaminated by rate-limit burst: ${check.detail}`
    )
  }
})

test('rate-limit check is not run when security level is not requested', async () => {
  // When the caller asks for governance-only, we must not burst — otherwise we
  // would drain the bucket without even reporting a security check.
  const srv = new GlyphServer({ rateLimit: { windowMs: 60_000, max: 5 } })
  registerFixtures(srv)
  const report = await runConformance('http://glyph', {
    fetch: srv.fetch,
    levels: ['governance'],
    fixtures: FIXTURE_NAMES,
  })
  assert.equal(
    report.checks.find((c) => c.name === 'security.rateLimit'),
    undefined,
    'security.rateLimit must not be emitted when security level was not requested'
  )
})

test('the report flags a non-Glyph endpoint', async () => {
  const report = await runConformance('http://glyph', {
    fetch: () => new Response('not glyph', { status: 200 }),
    levels: ['discovery'],
  })
  assert.equal(report.passed, false)
})
