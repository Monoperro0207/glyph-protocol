import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fromLexicon } from '../src/index.js'

const fakeClient = {
  async call(_n: string, input: unknown) {
    return { payload: input, type: 'data' }
  },
  async prepare() {
    return { confirmationToken: 't', cost: {}, glyphId: 'a', name: 'x', input: {}, expiresAt: 'now' }
  },
}

test('fromLexicon yields a LlamaIndex tool per lexicon entry', () => {
  const tools = fromLexicon(fakeClient as any, [
    { id: 'a', name: 'search', intent: 'Search', tags: [], riskTier: 'safe' },
  ])
  assert.equal(tools[0].name, 'search')
  assert.equal(typeof tools[0].fn, 'function')
})

test('fn returns the unwrapped payload', async () => {
  const tools = fromLexicon(fakeClient as any, [
    { id: 'a', name: 'search', intent: 'Search', tags: [], riskTier: 'safe' },
  ])
  const out = await tools[0].fn({ q: 'a' })
  assert.deepEqual(out, { q: 'a' })
})
