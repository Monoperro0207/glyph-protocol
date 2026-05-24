import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fromLexicon } from '../src/index.js'

const fakeClient = {
  async call(_name: string, input: unknown) {
    return { payload: { input }, type: 'data' }
  },
  async prepare() {
    return { confirmationToken: 'tok', cost: {}, glyphId: 'a', name: 'x', input: {}, expiresAt: 'now' }
  },
}

test('fromLexicon yields a LangChain-shaped tool per glyph', () => {
  const tools = fromLexicon(fakeClient as any, [
    { id: 'a', name: 'lookup', intent: 'Lookup', tags: [], riskTier: 'safe' },
  ])
  assert.equal(tools.length, 1)
  assert.equal(tools[0].name, 'lookup')
  assert.equal(typeof tools[0].invoke, 'function')
})

test('invoke returns JSON-encoded payload', async () => {
  const tools = fromLexicon(fakeClient as any, [
    { id: 'a', name: 'lookup', intent: 'Lookup', tags: [], riskTier: 'safe' },
  ])
  const result = await tools[0].invoke({ q: 'glyph' })
  assert.equal(JSON.parse(result).input.q, 'glyph')
})
