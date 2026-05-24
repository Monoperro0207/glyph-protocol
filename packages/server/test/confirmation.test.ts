import { test } from 'node:test'
import assert from 'node:assert/strict'
import { z } from 'zod'
import { defineGlyph, GlyphServer } from '../src/index.js'

const safe = defineGlyph({
  name: 'safe-op',
  intent: 'A safe, read-only operation',
  cost: {
    latency: 'fast',
    sideEffects: false,
    reversible: true,
    riskTier: 'safe',
    requiresConfirmation: false,
  },
  input: z.object({ x: z.number() }),
  output: z.object({ x: z.number() }),
  provider: 'test',
  handler: async (i) => i,
})

const risky = defineGlyph({
  name: 'risky-op',
  intent: 'A dangerous, irreversible operation',
  cost: {
    latency: 'fast',
    sideEffects: true,
    reversible: false,
    riskTier: 'danger',
    requiresConfirmation: true,
  },
  input: z.object({ x: z.number() }),
  output: z.object({ ok: z.boolean() }),
  provider: 'test',
  handler: async () => ({ ok: true }),
})

const server = new GlyphServer()
server.register(safe)
server.register(risky)

async function post(path: string, body: unknown) {
  const res = await server.fetch(
    new Request(`http://glyph${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  )
  return { status: res.status, body: (await res.json()) as any }
}

test('a glyph without requiresConfirmation runs directly', async () => {
  const res = await post('/glyphs/safe-op/call', { input: { x: 1 } })
  assert.equal(res.status, 200)
  assert.equal(res.body.type, 'data')
})

test('a requiresConfirmation glyph is blocked without a token', async () => {
  const res = await post('/glyphs/risky-op/call', { input: { x: 1 } })
  assert.equal(res.status, 403)
  assert.equal(res.body.error.code, 'CONFIRMATION_REQUIRED')
})

test('prepare issues a ticket carrying the risk summary', async () => {
  const res = await post('/glyphs/risky-op/prepare', { input: { x: 1 } })
  assert.equal(res.status, 200)
  assert.ok(res.body.confirmationToken)
  assert.equal(res.body.cost.riskTier, 'danger')
})

test('a valid token unlocks the call', async () => {
  const prep = await post('/glyphs/risky-op/prepare', { input: { x: 7 } })
  const res = await post('/glyphs/risky-op/call', {
    input: { x: 7 },
    confirmationToken: prep.body.confirmationToken,
  })
  assert.equal(res.status, 200)
  assert.equal(res.body.type, 'data')
})

test('a confirmation token is single-use → second use → INVALID_CONFIRMATION', async () => {
  const prep = await post('/glyphs/risky-op/prepare', { input: { x: 7 } })
  const token = prep.body.confirmationToken
  const first = await post('/glyphs/risky-op/call', {
    input: { x: 7 },
    confirmationToken: token,
  })
  const second = await post('/glyphs/risky-op/call', {
    input: { x: 7 },
    confirmationToken: token,
  })
  assert.equal(first.status, 200)
  assert.equal(second.status, 403)
  assert.equal(second.body.error.code, 'INVALID_CONFIRMATION')
})

test('a bogus token is rejected with INVALID_CONFIRMATION (not CONFIRMATION_REQUIRED)', async () => {
  const res = await post('/glyphs/risky-op/call', {
    input: { x: 1 },
    confirmationToken: 'not-a-real-token',
  })
  assert.equal(res.status, 403)
  assert.equal(res.body.error.code, 'INVALID_CONFIRMATION')
})

test('a token bound to a different input → INVALID_CONFIRMATION', async () => {
  const prep = await post('/glyphs/risky-op/prepare', { input: { x: 1 } })
  const res = await post('/glyphs/risky-op/call', {
    input: { x: 999 },
    confirmationToken: prep.body.confirmationToken,
  })
  assert.equal(res.status, 403)
  assert.equal(res.body.error.code, 'INVALID_CONFIRMATION')
})

test('prepare rejects invalid input', async () => {
  const res = await post('/glyphs/risky-op/prepare', {
    input: { x: 'not a number' },
  })
  assert.equal(res.status, 400)
})
