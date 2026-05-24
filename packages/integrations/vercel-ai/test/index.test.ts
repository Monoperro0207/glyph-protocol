import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fromLexicon } from '../src/index.js'

const fakeClient = {
  async getLexicon() {
    return [
      { id: 'a', name: 'echo', intent: 'Echo', tags: [], riskTier: 'safe' as const },
    ]
  },
  async call(name: string, input: unknown) {
    return {
      type: 'data',
      glyphId: 'a',
      callId: '1',
      payload: { echoed: name, input },
      meta: { latencyMs: 1, provider: 'test', timestamp: 'now' },
    }
  },
  async prepare(_name: string, _input: unknown) {
    return { confirmationToken: 'tok', cost: {}, glyphId: 'a', name: 'echo', input: {}, expiresAt: 'now' }
  },
}

test('fromLexicon produces one tool per lexicon entry', () => {
  const tools = fromLexicon(fakeClient as any, [
    { id: 'a', name: 'echo', intent: 'Echo', tags: [], riskTier: 'safe' },
  ])
  assert.ok(tools.echo)
  assert.equal(tools.echo.description, 'Echo')
})

test('tool execute calls the glyph and returns payload', async () => {
  const tools = fromLexicon(fakeClient as any, [
    { id: 'a', name: 'echo', intent: 'Echo', tags: [], riskTier: 'safe' },
  ])
  const result = await tools.echo.execute({ value: 'hi' })
  assert.deepEqual(result, { echoed: 'echo', input: { value: 'hi' } })
})
