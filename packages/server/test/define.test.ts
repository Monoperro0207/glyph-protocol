import { test } from 'node:test'
import assert from 'node:assert/strict'
import { z } from 'zod'
import { defineGlyph } from '../src/index.js'

const echo = defineGlyph({
  name: 'echo',
  intent: 'Echoes the input message back',
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

test('defineGlyph generates a content-addressed sha256 id', () => {
  assert.match(echo.card.id, /^[0-9a-f]{64}$/)
})

test('defineGlyph leaves the card unsigned (the server signs at register)', () => {
  assert.equal(echo.card.signature, undefined)
  assert.equal(echo.card.publicKey, undefined)
})

test('defineGlyph converts the zod input schema to JSON Schema', () => {
  assert.equal((echo.card.input as Record<string, unknown>).type, 'object')
})

test('inputSchema rejects invalid input and accepts valid input', () => {
  assert.equal(echo.inputSchema.safeParse({ msg: 123 }).success, false)
  assert.equal(echo.inputSchema.safeParse({ msg: 'hi' }).success, true)
})
