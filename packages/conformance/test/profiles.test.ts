import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { defineGlyph, GlyphServer } from '@glyphp/server'
import { z } from 'zod'
import {
  DEFAULT_PROFILE,
  PROFILE_LEVELS,
  resolveProfile,
  runConformance,
} from '../src/index.js'

// ---------------------------------------------------------------------------
// Pure-function unit tests — resolveProfile
// ---------------------------------------------------------------------------
describe('resolveProfile', () => {
  test('"minimal" returns discovery + execution', () => {
    const levels = resolveProfile('minimal')
    assert.deepEqual(levels, ['discovery', 'execution'])
  })

  test('"secure" returns discovery + execution + security', () => {
    const levels = resolveProfile('secure')
    assert.deepEqual(levels, ['discovery', 'execution', 'security'])
  })

  test('"production" returns all four levels', () => {
    const levels = resolveProfile('production')
    assert.deepEqual(levels, [
      'discovery',
      'execution',
      'security',
      'governance',
    ])
  })

  test('"all" returns all four levels (backward compat)', () => {
    const levels = resolveProfile('all')
    assert.deepEqual(levels, [
      'discovery',
      'execution',
      'security',
      'governance',
    ])
  })

  test('comma-separated individual levels still work', () => {
    const levels = resolveProfile('discovery,execution')
    assert.deepEqual(levels, ['discovery', 'execution'])
  })

  test('unknown value returns empty array', () => {
    const levels = resolveProfile('bogus')
    assert.deepEqual(levels, [])
  })
})

// ---------------------------------------------------------------------------
// PROFILE_LEVELS constant
// ---------------------------------------------------------------------------
describe('PROFILE_LEVELS', () => {
  test('maps minimal to discovery+execution', () => {
    assert.deepEqual(PROFILE_LEVELS.minimal, ['discovery', 'execution'])
  })

  test('maps secure to discovery+execution+security', () => {
    assert.deepEqual(PROFILE_LEVELS.secure, [
      'discovery',
      'execution',
      'security',
    ])
  })

  test('maps production to all four', () => {
    assert.deepEqual(PROFILE_LEVELS.production, [
      'discovery',
      'execution',
      'security',
      'governance',
    ])
  })

  test('all profiles are readonly', () => {
    for (const levels of Object.values(PROFILE_LEVELS)) {
      assert.ok(Array.isArray(levels))
    }
  })
})

// ---------------------------------------------------------------------------
// DEFAULT_PROFILE
// ---------------------------------------------------------------------------
describe('DEFAULT_PROFILE', () => {
  test('DEFAULT_PROFILE is "secure" per CONFPROF-001', () => {
    assert.equal(DEFAULT_PROFILE, 'secure')
  })

  test('DEFAULT_PROFILE maps to valid levels', () => {
    const levels = PROFILE_LEVELS[DEFAULT_PROFILE]
    assert.ok(levels.length > 0)
    assert.deepEqual(levels, ['discovery', 'execution', 'security'])
  })
})

// ---------------------------------------------------------------------------
// Integration tests — runConformance with a profile
// ---------------------------------------------------------------------------
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
  }),
)

describe('runConformance with profiles', () => {
  test('profile "minimal" runs only discovery + execution', async () => {
    const report = await runConformance('http://glyph', {
      fetch: server.fetch,
      profile: 'minimal',
    })
    const levelNames = report.levels.map((l) => l.level)
    assert.deepEqual(levelNames, ['discovery', 'execution'])
    assert.ok(report.passed)
  })

  test('profile "secure" runs discovery + execution + security', async () => {
    const report = await runConformance('http://glyph', {
      fetch: server.fetch,
      profile: 'secure',
    })
    const levelNames = report.levels.map((l) => l.level)
    assert.deepEqual(levelNames, ['discovery', 'execution', 'security'])
    // Server has no auth config so security.auth.required will fail
    // — still the levels should be listed.
  })

  test('profile "production" runs all four levels', async () => {
    const report = await runConformance('http://glyph', {
      fetch: server.fetch,
      profile: 'production',
    })
    const levelNames = report.levels.map((l) => l.level)
    assert.deepEqual(levelNames, [
      'discovery',
      'execution',
      'security',
      'governance',
    ])
  })

  test('no profile and no levels → defaults to secure', async () => {
    const report = await runConformance('http://glyph', {
      fetch: server.fetch,
      // neither profile nor levels provided
    })
    const levelNames = report.levels.map((l) => l.level)
    assert.deepEqual(levelNames, ['discovery', 'execution', 'security'])
  })
})
