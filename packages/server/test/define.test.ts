import assert from 'node:assert/strict'
import { test } from 'node:test'
import { computeGlyphId } from '@glyphp/core'
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

const stabilityGlyph = defineGlyph({
  name: 'schema-stability-fixture',
  intent: 'Exercises schema conversion stability for release gates',
  cost: {
    latency: 'fast',
    sideEffects: false,
    reversible: true,
    riskTier: 'safe',
    requiresConfirmation: false,
  },
  input: z.object({
    query: z.string(),
    limit: z.number().int().optional(),
    mode: z.enum(['fast', 'deep']),
    filters: z.object({ tag: z.string().optional() }),
    ids: z.array(z.string()),
  }),
  output: z.object({
    ok: z.boolean(),
    rows: z.array(z.object({ id: z.string(), score: z.number() })),
  }),
  provider: 'test',
  handler: async () => ({ ok: true, rows: [] }),
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

test('defineGlyph keeps representative generated schemas stable', () => {
  assert.deepEqual(stabilityGlyph.card.input, {
    type: 'object',
    properties: {
      query: { type: 'string' },
      limit: { type: 'integer' },
      mode: { type: 'string', enum: ['fast', 'deep'] },
      filters: {
        type: 'object',
        properties: { tag: { type: 'string' } },
        additionalProperties: false,
      },
      ids: { type: 'array', items: { type: 'string' } },
    },
    required: ['query', 'mode', 'filters', 'ids'],
    additionalProperties: false,
    $schema: 'http://json-schema.org/draft-07/schema#',
  })
  assert.deepEqual(stabilityGlyph.card.output, {
    type: 'object',
    properties: {
      ok: { type: 'boolean' },
      rows: {
        type: 'array',
        items: {
          type: 'object',
          properties: { id: { type: 'string' }, score: { type: 'number' } },
          required: ['id', 'score'],
          additionalProperties: false,
        },
      },
    },
    required: ['ok', 'rows'],
    additionalProperties: false,
    $schema: 'http://json-schema.org/draft-07/schema#',
  })
})

test('defineGlyph keeps representative card identity stable', () => {
  assert.equal(computeGlyphId(stabilityGlyph.card), stabilityGlyph.card.id)
  assert.equal(stabilityGlyph.card.id, '7728d10255970b969b7e29255feb2b6a8093a8b10bc85003694373a18b799562')
})
