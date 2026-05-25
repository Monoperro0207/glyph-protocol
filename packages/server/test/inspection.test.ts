import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sanitize, verifyReceipt } from '@glyphp/core'
import { z } from 'zod'
import { defineGlyph, GlyphServer } from '../src/index.js'

// Invisible characters built at runtime so this file stays free of them.
const RLO = String.fromCodePoint(0x202e) // right-to-left override
const TAG = String.fromCodePoint(0xe0041) // Unicode tag block char

const tainted = defineGlyph({
  name: 'tainted',
  intent: 'Returns output carrying invisible characters',
  cost: {
    latency: 'fast',
    sideEffects: false,
    reversible: true,
    riskTier: 'safe',
    requiresConfirmation: false,
  },
  input: z.object({}),
  output: z.object({ msg: z.string() }),
  provider: 'test',
  handler: async () => ({ msg: `hello${RLO}${TAG}${TAG}world` }),
})

const server = new GlyphServer()
server.register(tainted)

async function call() {
  const res = await server.fetch(
    new Request('http://glyph/glyphs/tainted/call', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input: {} }),
    }),
  )
  return (await res.json()) as any
}

test('the server strips invisible characters from the delivered payload', async () => {
  const body = await call()
  assert.deepEqual(body.payload, { msg: 'helloworld' })
})

test('the envelope reports what sanitization removed', async () => {
  const body = await call()
  assert.equal(body.inspection.modified, true)
  const kinds = body.inspection.findings.map((f: any) => f.kind).sort()
  assert.deepEqual(kinds, ['bidi-override', 'unicode-tags'])
})

test('the receipt verifies and commits to the inspection report', async () => {
  const body = await call()
  assert.equal(verifyReceipt(body.receipt), true)
  assert.match(body.receipt.inspectionHash, /^[0-9a-f]{64}$/)
})

test('re-sanitizing the delivered payload finds nothing (idempotent)', async () => {
  const body = await call()
  assert.equal(sanitize(body.payload).report.modified, false)
})
