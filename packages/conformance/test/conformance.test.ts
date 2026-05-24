import { test } from 'node:test'
import assert from 'node:assert/strict'
import { z } from 'zod'
import { defineGlyph, GlyphServer } from '@glyphp/server'
import { runConformance } from '../src/index.js'

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

test('the report flags a non-Glyph endpoint', async () => {
  const report = await runConformance('http://glyph', {
    fetch: () => new Response('not glyph', { status: 200 }),
    levels: ['discovery'],
  })
  assert.equal(report.passed, false)
})
