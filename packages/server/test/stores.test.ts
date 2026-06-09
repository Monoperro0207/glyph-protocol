import assert from 'node:assert/strict'
import { test } from 'node:test'
import { z } from 'zod'
import {
  defineGlyph,
  GlyphServer,
  MemoryConfirmationStore,
  MemoryRateLimitStore,
} from '../src/index.js'

const makeDanger = () =>
  defineGlyph({
    name: 'wipe',
    intent: 'Dangerous tool that requires confirmation',
    cost: {
      latency: 'fast',
      sideEffects: true,
      reversible: false,
      riskTier: 'danger',
      requiresConfirmation: true,
    },
    input: z.object({ target: z.string() }),
    output: z.object({ ok: z.boolean() }),
    provider: 'test',
    handler: async () => ({ ok: true }),
  })

test('a confirmation issued by one replica is consumable on another via a shared store', async () => {
  const shared = new MemoryConfirmationStore()
  const replicaA = new GlyphServer({ confirmationStore: shared }).register(makeDanger())
  const replicaB = new GlyphServer({ confirmationStore: shared }).register(makeDanger())

  const prep = await replicaA.fetch(
    new Request('http://glyph/glyphs/wipe/prepare', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input: { target: 'x' } }),
    }),
  )
  assert.equal(prep.status, 200)
  const { confirmationToken } = await prep.json()

  const call = await replicaB.fetch(
    new Request('http://glyph/glyphs/wipe/call', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input: { target: 'x' }, confirmationToken }),
    }),
  )
  assert.equal(call.status, 200, await call.clone().text())
})

test('consume is single-use even across replicas', async () => {
  const shared = new MemoryConfirmationStore()
  const replicaA = new GlyphServer({ confirmationStore: shared }).register(makeDanger())
  const replicaB = new GlyphServer({ confirmationStore: shared }).register(makeDanger())

  const prep = await replicaA.fetch(
    new Request('http://glyph/glyphs/wipe/prepare', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input: { target: 'x' } }),
    }),
  )
  const { confirmationToken } = await prep.json()

  const callBody = JSON.stringify({ input: { target: 'x' }, confirmationToken })
  const first = await replicaA.fetch(
    new Request('http://glyph/glyphs/wipe/call', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: callBody,
    }),
  )
  assert.equal(first.status, 200)
  const replay = await replicaB.fetch(
    new Request('http://glyph/glyphs/wipe/call', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: callBody,
    }),
  )
  assert.equal(replay.status, 403)
  const err = await replay.json()
  assert.equal(err.error.code, 'INVALID_CONFIRMATION')
})

test('without an injected store, confirmations stay per instance (current default)', async () => {
  const replicaA = new GlyphServer().register(makeDanger())
  const replicaB = new GlyphServer().register(makeDanger())

  const prep = await replicaA.fetch(
    new Request('http://glyph/glyphs/wipe/prepare', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input: { target: 'x' } }),
    }),
  )
  const { confirmationToken } = await prep.json()
  const cross = await replicaB.fetch(
    new Request('http://glyph/glyphs/wipe/call', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input: { target: 'x' }, confirmationToken }),
    }),
  )
  assert.equal(cross.status, 403)
})

test('a shared RateLimitStore enforces one global limit across replicas', async () => {
  const shared = new MemoryRateLimitStore()
  const opts = { rateLimit: { windowMs: 60_000, max: 3 }, rateLimitStore: shared }
  const replicaA = new GlyphServer(opts)
  const replicaB = new GlyphServer(opts)

  // 2 hits on A + 1 on B exhaust the shared budget of 3 (same IP key).
  for (const replica of [replicaA, replicaA, replicaB]) {
    const res = await replica.fetch(new Request('http://glyph/lexicon'))
    assert.equal(res.status, 200)
  }
  const limited = await replicaB.fetch(new Request('http://glyph/lexicon'))
  assert.equal(limited.status, 429)
  assert.ok(limited.headers.get('Retry-After'))
})

test('MemoryConfirmationStore sweep drops expired entries and reports backlog', async () => {
  const store = new MemoryConfirmationStore()
  await store.put('t1', { glyphName: 'a', inputHash: 'h', expiresAt: 100 })
  await store.put('t2', { glyphName: 'a', inputHash: 'h', expiresAt: 300 })
  const backlog = await store.sweep(200)
  assert.deepEqual(backlog, { size: 1, earliestExpiresAt: 300 })
  assert.equal(await store.consume('t1'), undefined)
  assert.ok(await store.consume('t2'))
  assert.equal(await store.consume('t2'), undefined, 'consume is single-use')
})
