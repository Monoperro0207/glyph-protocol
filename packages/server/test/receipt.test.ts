import assert from 'node:assert/strict'
import { test } from 'node:test'
import { verifyReceipt } from '@glyphp/core'
import type { CallReceipt } from '@glyphp/types'
import { z } from 'zod'
import { defineGlyph, GlyphServer } from '../src/index.js'

const echo = defineGlyph({
  name: 'echo',
  intent: 'Echoes the input back',
  cost: {
    latency: 'fast',
    sideEffects: false,
    reversible: true,
    riskTier: 'safe',
    requiresConfirmation: false,
  },
  input: z.object({ msg: z.string() }),
  output: z.object({ msg: z.string() }),
  provider: 'test',
  handler: async (i) => i,
})

const captured: CallReceipt[] = []
const server = new GlyphServer({ onCall: (r) => captured.push(r) })
server.register(echo)

async function call() {
  const res = await server.fetch(
    new Request('http://glyph/glyphs/echo/call', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input: { msg: 'hi' } }),
    }),
  )
  return (await res.json()) as any
}

test('a successful call returns a signed receipt in the envelope', async () => {
  const body = await call()
  assert.ok(body.receipt, 'envelope should carry a receipt')
  assert.equal(body.receipt.glyphName, 'echo')
  assert.equal(body.receipt.riskTier, 'safe')
  assert.equal(verifyReceipt(body.receipt), true)
})

test('the receipt callId matches the envelope callId', async () => {
  const body = await call()
  assert.equal(body.receipt.callId, body.callId)
})

test('the onCall audit hook receives the same receipt', async () => {
  const before = captured.length
  const body = await call()
  assert.equal(captured.length, before + 1)
  assert.equal(captured[captured.length - 1].callId, body.receipt.callId)
})

test('the receipt records hashes of the input, output and inspection', async () => {
  const body = await call()
  assert.match(body.receipt.inputHash, /^[0-9a-f]{64}$/)
  assert.match(body.receipt.outputHash, /^[0-9a-f]{64}$/)
  assert.match(body.receipt.inspectionHash, /^[0-9a-f]{64}$/)
})

// --- Server-generated callId tests (Fix 2) ---

test('callId is always server-generated UUID v4 even when client sends one', async () => {
  const res = await server.fetch(
    new Request('http://glyph/glyphs/echo/call', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        input: { msg: 'hi' },
        callId: 'attacker-chosen-value',
      }),
    }),
  )
  const body = (await res.json()) as any
  assert.equal(res.status, 200)
  // callId must NOT be the attacker-chosen value
  assert.notEqual(body.receipt.callId, 'attacker-chosen-value')
  // callId must be a UUID v4 (36 chars with dashes at positions 8,13,18,23)
  assert.match(
    body.receipt.callId,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  )
})

test('clientCallId is preserved when client sends callId', async () => {
  const res = await server.fetch(
    new Request('http://glyph/glyphs/echo/call', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        input: { msg: 'hi' },
        callId: 'client-tracker-123',
      }),
    }),
  )
  const body = (await res.json()) as any
  assert.equal(res.status, 200)
  assert.equal(body.receipt.clientCallId, 'client-tracker-123')
  // callId is still server-generated, not the client value
  assert.notEqual(body.receipt.callId, 'client-tracker-123')
})

test('no clientCallId field when client does not send callId', async () => {
  const res = await server.fetch(
    new Request('http://glyph/glyphs/echo/call', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input: { msg: 'hi' } }),
    }),
  )
  const body = (await res.json()) as any
  assert.equal(res.status, 200)
  // clientCallId should be undefined (not present in the JSON)
  assert.equal(body.receipt.clientCallId, undefined)
})

test('receiptVersion is 0.3 after bump', async () => {
  const body = await call()
  assert.equal(body.receipt.receiptVersion, '0.3')
})
