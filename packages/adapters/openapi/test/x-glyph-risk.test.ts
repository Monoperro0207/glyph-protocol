import assert from 'node:assert/strict'
import { test } from 'node:test'
import { glyphsFromOpenApi } from '../src/index.js'
import type { OpenApiDoc } from '../src/openapi-types.js'

// `x-glyph-risk` lets the API author override the HTTP-method risk heuristic.
// It is trusted at the same level as the rest of the spec (the API owner writes
// it), so it can both raise and lower the derived tier.

function docWith(method: string, op: Record<string, unknown>): OpenApiDoc {
  return {
    openapi: '3.0.0',
    info: { title: 'T', version: '1.0.0' },
    paths: { '/thing': { [method]: { operationId: 'thing', ...op } } },
  } as OpenApiDoc
}

function riskOf(doc: OpenApiDoc) {
  const [g] = glyphsFromOpenApi(doc, { baseUrl: 'https://api.example.com' })
  return g.card.cost
}

test('x-glyph-risk lowers a POST from caution to safe', () => {
  const cost = riskOf(docWith('post', { 'x-glyph-risk': 'safe' }))
  assert.equal(cost.riskTier, 'safe')
  assert.equal(cost.requiresConfirmation, false)
  // …but it still honestly reports the POST mutates state.
  assert.equal(cost.sideEffects, true)
})

test('x-glyph-risk raises a GET to danger and forces confirmation', () => {
  const cost = riskOf(docWith('get', { 'x-glyph-risk': 'danger' }))
  assert.equal(cost.riskTier, 'danger')
  assert.equal(cost.requiresConfirmation, true)
  assert.equal(cost.sideEffects, false) // a GET still does not mutate
})

test('x-glyph-risk can lower a DELETE off the danger default', () => {
  const cost = riskOf(docWith('delete', { 'x-glyph-risk': 'caution' }))
  assert.equal(cost.riskTier, 'caution')
  assert.equal(cost.requiresConfirmation, false)
})

test('no x-glyph-risk keeps the method-derived tier', () => {
  assert.equal(riskOf(docWith('post', {})).riskTier, 'caution')
  assert.equal(riskOf(docWith('delete', {})).riskTier, 'danger')
})

test('an unrecognised x-glyph-risk value fails closed', () => {
  assert.throws(
    () =>
      glyphsFromOpenApi(docWith('get', { 'x-glyph-risk': 'extreme' }), {
        baseUrl: 'https://api.example.com',
      }),
    /invalid x-glyph-risk "extreme"/,
  )
})
