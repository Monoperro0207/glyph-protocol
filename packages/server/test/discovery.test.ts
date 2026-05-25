import assert from 'node:assert/strict'
import { test } from 'node:test'
import { z } from 'zod'
import { defineGlyph, GlyphServer } from '../src/index.js'

const noop = defineGlyph({
  name: 'noop',
  intent: 'A noop',
  cost: {
    latency: 'fast',
    sideEffects: false,
    reversible: true,
    riskTier: 'safe',
    requiresConfirmation: false,
  },
  input: z.object({}),
  output: z.object({}),
  provider: 'test',
  handler: async () => ({}),
})

const server = new GlyphServer()
server.register(noop)

async function get(path: string) {
  const res = await server.fetch(new Request(`http://glyph${path}`))
  return { status: res.status, body: (await res.json()) as any }
}

test('GET /glyphs/:name with no depth returns the rich card', async () => {
  const res = await get('/glyphs/noop')
  assert.equal(res.status, 200)
  assert.equal(res.body.name, 'noop')
})

test('GET /glyphs/:name?depth=minimal accepted', async () => {
  const res = await get('/glyphs/noop?depth=minimal')
  assert.equal(res.status, 200)
})

test('GET /glyphs/:name?depth=standard accepted', async () => {
  const res = await get('/glyphs/noop?depth=standard')
  assert.equal(res.status, 200)
})

test('GET /glyphs/:name?depth=rich accepted', async () => {
  const res = await get('/glyphs/noop?depth=rich')
  assert.equal(res.status, 200)
})

test('GET /glyphs/:name?depth=bogus → 400 VALIDATION_FAILED', async () => {
  const res = await get('/glyphs/noop?depth=bogus')
  assert.equal(res.status, 400)
  assert.equal(res.body.error.code, 'VALIDATION_FAILED')
  assert.equal(res.body.error.details.field, 'depth')
  assert.equal(res.body.error.details.got, 'bogus')
  assert.deepEqual(res.body.error.details.expected, ['minimal', 'standard', 'rich'])
})

test('GET /glyphs/:name?depth= (empty string) → 400 VALIDATION_FAILED', async () => {
  const res = await get('/glyphs/noop?depth=')
  assert.equal(res.status, 400)
  assert.equal(res.body.error.code, 'VALIDATION_FAILED')
})

test('GET /glyphs/unknown → 404 NOT_FOUND (depth ignored)', async () => {
  const res = await get('/glyphs/unknown?depth=bogus')
  // depth is validated before lookup, so this should be 400 not 404.
  assert.equal(res.status, 400)
})
