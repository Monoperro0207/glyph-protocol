import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fromLexicon } from '../src/index.js'

const fakeClient = {
  async call(_n: string, input: unknown) {
    return { payload: { input }, type: 'data' }
  },
  async prepare() {
    return { confirmationToken: 't', cost: {}, glyphId: 'a', name: 'x', input: {}, expiresAt: 'now' }
  },
}

test('fromLexicon yields an OpenAI Agents tool per glyph', () => {
  const tools = fromLexicon(fakeClient as any, [
    { id: 'a', name: 'order', intent: 'Place order', tags: [], riskTier: 'caution' },
  ])
  assert.equal(tools.length, 1)
  assert.equal(tools[0].name, 'order')
  assert.equal(typeof tools[0].execute, 'function')
})

test('execute returns the unwrapped payload', async () => {
  const tools = fromLexicon(fakeClient as any, [
    { id: 'a', name: 'order', intent: 'Place order', tags: [], riskTier: 'caution' },
  ])
  const out = await tools[0].execute({ id: 1 })
  assert.deepEqual(out, { input: { id: 1 } })
})
