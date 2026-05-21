import { test } from 'node:test'
import assert from 'node:assert/strict'
import { z } from 'zod'
import { verifyReceipt } from '@glyph/core'
import type { CallReceipt } from '@glyph/types'
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
    })
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

test('the receipt records hashes of the input and output', async () => {
  const body = await call()
  assert.match(body.receipt.inputHash, /^[0-9a-f]{64}$/)
  assert.match(body.receipt.outputHash, /^[0-9a-f]{64}$/)
})
