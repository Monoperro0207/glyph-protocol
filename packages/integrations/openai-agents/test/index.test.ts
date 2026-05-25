import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fromLexicon, glyphsAsOpenAiAgentTools } from '../src/index.js'

const fakeClient = {
  async call(_n: string, input: unknown) {
    return { payload: { input }, type: 'data' }
  },
  async prepare() {
    return {
      confirmationToken: 't',
      cost: {},
      glyphId: 'a',
      name: 'x',
      input: {},
      expiresAt: 'now',
    }
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

function makeRichClient(opts: { requireConfirmation?: boolean } = {}) {
  let callCount = 0
  const calls: Array<{ confirmationToken?: string }> = []
  return {
    calls,
    get callCount() {
      return callCount
    },
    async getLexicon() {
      return [
        { id: 'a', name: 'order', intent: 'Place order', tags: [], riskTier: 'caution' as const },
      ]
    },
    async getCard() {
      return {
        id: 'a',
        name: 'order',
        intent: 'Place order',
        input: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] },
        output: { type: 'object' },
        tags: [],
        riskTier: 'caution',
      }
    },
    async call(_n: string, _i: unknown, options?: { confirmationToken?: string }) {
      callCount++
      calls.push({ confirmationToken: options?.confirmationToken })
      if (opts.requireConfirmation && !options?.confirmationToken) {
        const e: any = new Error('confirm')
        e.code = 'CONFIRMATION_REQUIRED'
        throw e
      }
      return { type: 'data', payload: { ok: true } }
    },
    async prepare() {
      return {
        confirmationToken: 'real-tok',
        cost: {},
        glyphId: 'a',
        name: 'order',
        input: {},
        expiresAt: 'soon',
      }
    },
  }
}

test('glyphsAsOpenAiAgentTools exposes real card.input as parameters', async () => {
  const client = makeRichClient()
  const tools = await glyphsAsOpenAiAgentTools(client as any)
  const params = tools[0].parameters as any
  assert.equal(params.type, 'object')
  assert.ok(params.properties.id)
})

test('onConfirmation=false does NOT execute', async () => {
  const client = makeRichClient({ requireConfirmation: true })
  const tools = await glyphsAsOpenAiAgentTools(client as any, { onConfirmation: async () => false })
  await assert.rejects(() => tools[0].execute({ id: 1 }))
  assert.equal(client.callCount, 1)
})

test('onConfirmation="reject" does NOT execute (regression)', async () => {
  const client = makeRichClient({ requireConfirmation: true })
  const tools = await glyphsAsOpenAiAgentTools(client as any, {
    onConfirmation: async () => 'reject' as unknown as boolean,
  })
  await assert.rejects(() => tools[0].execute({ id: 1 }))
  assert.equal(client.callCount, 1)
})

test('onConfirmation=true authorizes with bound token', async () => {
  const client = makeRichClient({ requireConfirmation: true })
  const tools = await glyphsAsOpenAiAgentTools(client as any, { onConfirmation: async () => true })
  await tools[0].execute({ id: 1 })
  assert.equal(client.callCount, 2)
  assert.equal(client.calls[1].confirmationToken, 'real-tok')
})
