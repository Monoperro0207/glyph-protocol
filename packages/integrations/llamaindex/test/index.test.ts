import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fromLexicon, glyphsAsLlamaIndexTools } from '../src/index.js'

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

function makeRichClient(opts: { requireConfirmation?: boolean } = {}) {
  let callCount = 0
  const calls: Array<{ confirmationToken?: string }> = []
  return {
    calls,
    get callCount() { return callCount },
    async getLexicon() {
      return [{ id: 'a', name: 'search', intent: 'Search', tags: [], riskTier: 'safe' as const }]
    },
    async getCard() {
      return {
        id: 'a', name: 'search', intent: 'Search',
        input: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] },
        output: { type: 'object' }, tags: [], riskTier: 'safe',
      }
    },
    async call(_n: string, _i: unknown, options?: { confirmationToken?: string }) {
      callCount++
      calls.push({ confirmationToken: options?.confirmationToken })
      if (opts.requireConfirmation && !options?.confirmationToken) {
        const e: any = new Error('confirm'); e.code = 'CONFIRMATION_REQUIRED'; throw e
      }
      return { type: 'data', payload: { ok: true } }
    },
    async prepare() {
      return { confirmationToken: 'real-tok', cost: {}, glyphId: 'a', name: 'search', input: {}, expiresAt: 'soon' }
    },
  }
}

test('glyphsAsLlamaIndexTools maps card.input to object parameters', async () => {
  const client = makeRichClient()
  const tools = await glyphsAsLlamaIndexTools(client as any)
  assert.equal(tools[0].parameters.type, 'object')
  assert.ok(tools[0].parameters.properties.q)
  assert.deepEqual(tools[0].parameters.required, ['q'])
})

test('onConfirmation=false does NOT execute', async () => {
  const client = makeRichClient({ requireConfirmation: true })
  const tools = await glyphsAsLlamaIndexTools(client as any, { onConfirmation: async () => false })
  await assert.rejects(() => tools[0].fn({ q: 'a' }))
  assert.equal(client.callCount, 1)
})

test('onConfirmation="reject" does NOT execute (regression)', async () => {
  const client = makeRichClient({ requireConfirmation: true })
  const tools = await glyphsAsLlamaIndexTools(client as any, {
    onConfirmation: async () => 'reject' as unknown as boolean,
  })
  await assert.rejects(() => tools[0].fn({ q: 'a' }))
  assert.equal(client.callCount, 1)
})

test('onConfirmation=true authorizes with bound token', async () => {
  const client = makeRichClient({ requireConfirmation: true })
  const tools = await glyphsAsLlamaIndexTools(client as any, { onConfirmation: async () => true })
  await tools[0].fn({ q: 'a' })
  assert.equal(client.callCount, 2)
  assert.equal(client.calls[1].confirmationToken, 'real-tok')
})
