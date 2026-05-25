import assert from 'node:assert/strict'
import { test } from 'node:test'
import { z } from 'zod'
import { defineGlyph, GlyphServer } from '../src/index.js'

const baseCost = {
  latency: 'fast' as const,
  sideEffects: false,
  reversible: true,
  riskTier: 'safe' as const,
  requiresConfirmation: false,
}

const honest = defineGlyph({
  name: 'honest',
  intent: 'Returns output that matches its declared schema',
  cost: baseCost,
  input: z.object({}),
  output: z.object({ value: z.number() }),
  provider: 'test',
  handler: async () => ({ value: 42 }),
})

const liar = defineGlyph({
  name: 'liar',
  intent: 'Declares a number but returns a string',
  cost: baseCost,
  input: z.object({}),
  output: z.object({ value: z.number() }),
  provider: 'test',
  handler: async () => ({ value: 'not a number' }) as any,
})

const thrower = defineGlyph({
  name: 'thrower',
  intent: 'A handler that throws',
  cost: baseCost,
  input: z.object({}),
  output: z.object({}),
  provider: 'test',
  handler: async () => {
    throw new Error('handler exploded')
  },
})

const slow = defineGlyph({
  name: 'slow',
  intent: 'A handler that never resolves in time',
  cost: baseCost,
  input: z.object({}),
  output: z.object({}),
  provider: 'test',
  handler: async () => {
    await new Promise((resolve) => {
      const t = setTimeout(resolve, 5000)
      t.unref()
    })
    return {}
  },
})

let abortFired = false
const signalAware = defineGlyph({
  name: 'signal-aware',
  intent: 'Records whether its abort signal fired before resolving',
  cost: baseCost,
  input: z.object({}),
  output: z.object({}),
  provider: 'test',
  handler: async (_input, ctx) => {
    ctx?.signal.addEventListener('abort', () => {
      abortFired = true
    })
    await new Promise((resolve) => {
      const t = setTimeout(resolve, 5000)
      t.unref()
    })
    return {}
  },
})

const server = new GlyphServer({ callTimeoutMs: 200 })
server.register(honest)
server.register(liar)
server.register(thrower)
server.register(slow)
server.register(signalAware)

async function call(name: string) {
  const res = await server.fetch(
    new Request(`http://glyph/glyphs/${name}/call`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input: {} }),
    }),
  )
  return { status: res.status, body: (await res.json()) as any }
}

test('output matching the declared schema passes through', async () => {
  const res = await call('honest')
  assert.equal(res.status, 200)
  assert.equal(res.body.type, 'data')
  assert.equal(res.body.payload.value, 42)
})

test('output not matching the schema → 502 OUTPUT_VALIDATION_FAILED', async () => {
  const res = await call('liar')
  assert.equal(res.status, 502)
  assert.equal(res.body.error.code, 'OUTPUT_VALIDATION_FAILED')
})

test('a handler that throws → 502 HANDLER_ERROR', async () => {
  const res = await call('thrower')
  assert.equal(res.status, 502)
  assert.equal(res.body.error.code, 'HANDLER_ERROR')
  assert.match(res.body.error.message, /exploded/)
})

test('a handler that exceeds the timeout → 504 HANDLER_TIMEOUT', async () => {
  const res = await call('slow')
  assert.equal(res.status, 504)
  assert.equal(res.body.error.code, 'HANDLER_TIMEOUT')
})

test('an unknown glyph → 404 NOT_FOUND', async () => {
  const res = await call('does-not-exist')
  assert.equal(res.status, 404)
  assert.equal(res.body.error.code, 'NOT_FOUND')
})

test('a malformed JSON body → 400 MALFORMED_JSON', async () => {
  const res = await server.fetch(
    new Request('http://glyph/glyphs/honest/call', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{ this is not json',
    }),
  )
  assert.equal(res.status, 400)
  const body = (await res.json()) as any
  assert.equal(body.error.code, 'MALFORMED_JSON')
})

test('register() rejects a duplicate glyph name', () => {
  // `honest` is already registered on the module-level server above.
  assert.throws(() => server.register(honest), /already registered/)
})

test('the handler abort signal fires when the call times out', async () => {
  abortFired = false
  const res = await call('signal-aware')
  assert.equal(res.status, 504)
  assert.equal(res.body.error.code, 'HANDLER_TIMEOUT')
  assert.equal(abortFired, true)
})

test('body larger than 1 MiB → 413 PAYLOAD_TOO_LARGE (Content-Length check)', async () => {
  const res = await server.fetch(
    new Request('http://glyph/glyphs/honest/call', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': String(2 * 1024 * 1024), // 2 MiB
      },
      body: JSON.stringify({ input: {} }),
    }),
  )
  assert.equal(res.status, 413)
  const body = (await res.json()) as any
  assert.equal(body.error.code, 'PAYLOAD_TOO_LARGE')
})

test('body within 1 MiB limit → parses normally', async () => {
  const res = await server.fetch(
    new Request('http://glyph/glyphs/honest/call', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input: {} }),
    }),
  )
  assert.equal(res.status, 200)
})

test('body at exact limit → parses normally', async () => {
  // Content-Length at 1 MiB (1_048_576) should be accepted
  const res = await server.fetch(
    new Request('http://glyph/glyphs/honest/call', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': '1048576',
      },
      body: JSON.stringify({ input: {} }),
    }),
  )
  assert.equal(res.status, 200)
})

test('custom maxBodyBytes override → respects lower limit', async () => {
  const lowLimitServer = new GlyphServer({ maxBodyBytes: 100 })
  lowLimitServer.register(honest)
  const res = await lowLimitServer.fetch(
    new Request('http://glyph/glyphs/honest/call', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': '101',
      },
      body: 'a',
    }),
  )
  assert.equal(res.status, 413)
  const body = (await res.json()) as any
  assert.equal(body.error.code, 'PAYLOAD_TOO_LARGE')
})

test('body without Content-Length → stream fallback rejects oversized payload', async () => {
  // No Content-Length header — readJson must measure the body from the stream
  const huge = 'x'.repeat(2 * 1024 * 1024) // 2 MiB
  const res = await server.fetch(
    new Request('http://glyph/glyphs/honest/call', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: huge,
    }),
  )
  assert.equal(res.status, 413)
  const body = (await res.json()) as any
  assert.equal(body.error.code, 'PAYLOAD_TOO_LARGE')
})
