import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fromLexicon, glyphsAsLangChainTools } from '../src/index.js'

const fakeClient = {
  async call(_name: string, input: unknown) {
    return { payload: { input }, type: 'data' }
  },
  async prepare() {
    return {
      confirmationToken: 'tok',
      cost: {},
      glyphId: 'a',
      name: 'x',
      input: {},
      expiresAt: 'now',
    }
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

function makeRichClient(opts: { requireConfirmation?: boolean } = {}) {
  let callCount = 0
  const calls: Array<{ confirmationToken?: string }> = []
  return {
    calls,
    get callCount() {
      return callCount
    },
    async getLexicon() {
      return [{ id: 'a', name: 'lookup', intent: 'Lookup', tags: [], riskTier: 'safe' as const }]
    },
    async getCard() {
      return {
        id: 'a',
        name: 'lookup',
        intent: 'Lookup',
        input: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] },
        output: { type: 'object' },
        tags: [],
        riskTier: 'safe',
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
        name: 'lookup',
        input: {},
        expiresAt: 'soon',
      }
    },
  }
}

test('glyphsAsLangChainTools exposes real card.input as jsonSchema', async () => {
  const client = makeRichClient()
  const tools = await glyphsAsLangChainTools(client as any)
  const schema = tools[0].schema.jsonSchema as any
  assert.equal(schema.type, 'object')
  assert.ok(schema.properties?.q)
})

test('onConfirmation=false does NOT execute the call', async () => {
  const client = makeRichClient({ requireConfirmation: true })
  const tools = await glyphsAsLangChainTools(client as any, { onConfirmation: async () => false })
  await assert.rejects(() => tools[0].invoke({ q: 'a' }))
  assert.equal(client.callCount, 1)
})

test('onConfirmation="reject" string does NOT execute (regression)', async () => {
  const client = makeRichClient({ requireConfirmation: true })
  const tools = await glyphsAsLangChainTools(client as any, {
    onConfirmation: async () => 'reject' as unknown as boolean,
  })
  await assert.rejects(() => tools[0].invoke({ q: 'a' }))
  assert.equal(client.callCount, 1)
})

test('onConfirmation=true authorizes with bound token', async () => {
  const client = makeRichClient({ requireConfirmation: true })
  const tools = await glyphsAsLangChainTools(client as any, { onConfirmation: async () => true })
  await tools[0].invoke({ q: 'a' })
  assert.equal(client.callCount, 2)
  assert.equal(client.calls[1].confirmationToken, 'real-tok')
})
