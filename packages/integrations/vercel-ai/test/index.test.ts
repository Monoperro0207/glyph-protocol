import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fromLexicon, glyphsAsVercelAiTools } from '../src/index.js'

const fakeClient = {
  async getLexicon() {
    return [{ id: 'a', name: 'echo', intent: 'Echo', tags: [], riskTier: 'safe' as const }]
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
    return {
      confirmationToken: 'tok',
      cost: {},
      glyphId: 'a',
      name: 'echo',
      input: {},
      expiresAt: 'now',
    }
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

// --- glyphsAsVercelAiTools: real schema + safe confirmation contract ---

function makeRichClient(
  opts: { callBehavior?: 'ok' | 'requires-confirmation'; cardInput?: unknown } = {},
) {
  let callCount = 0
  const calls: Array<{ name: string; input: unknown; confirmationToken?: string }> = []
  return {
    calls,
    get callCount() {
      return callCount
    },
    async getLexicon() {
      return [
        { id: 'a', name: 'send', intent: 'Send a message', tags: [], riskTier: 'caution' as const },
      ]
    },
    async getCard(_name: string, _depth?: string) {
      return {
        id: 'a',
        name: 'send',
        intent: 'Send a message',
        input: opts.cardInput ?? {
          type: 'object',
          properties: { to: { type: 'string' }, body: { type: 'string' } },
          required: ['to', 'body'],
        },
        output: { type: 'object' },
        tags: [],
        riskTier: 'caution',
      }
    },
    async call(name: string, input: unknown, options?: { confirmationToken?: string }) {
      callCount++
      calls.push({ name, input, confirmationToken: options?.confirmationToken })
      if (opts.callBehavior === 'requires-confirmation' && !options?.confirmationToken) {
        const err: any = new Error('confirmation required')
        err.code = 'CONFIRMATION_REQUIRED'
        throw err
      }
      return { type: 'data', payload: { ok: true, token: options?.confirmationToken } }
    },
    async prepare(_n: string, _i: unknown) {
      return {
        confirmationToken: 'real-ticket-token',
        cost: { riskTier: 'caution' },
        glyphId: 'a',
        name: 'send',
        input: {},
        expiresAt: 'soon',
      }
    },
  }
}

test('glyphsAsVercelAiTools exposes real card.input as the JSON schema', async () => {
  const client = makeRichClient()
  const tools = await glyphsAsVercelAiTools(client as any)
  const schema = tools.send.parameters.jsonSchema as any
  assert.equal(schema.type, 'object')
  assert.ok(schema.properties?.to, 'expected real input schema, not {}')
  assert.deepEqual(schema.required, ['to', 'body'])
})

test('onConfirmation returning false does NOT authorize the call', async () => {
  const client = makeRichClient({ callBehavior: 'requires-confirmation' })
  const tools = await glyphsAsVercelAiTools(client as any, {
    onConfirmation: async () => false,
  })
  await assert.rejects(() => tools.send.execute({ to: 'a', body: 'b' }), /confirmation required/)
  // 1 call: only the initial CONFIRMATION_REQUIRED attempt. No second call.
  assert.equal(client.callCount, 1)
})

test('onConfirmation returning the string "reject" does NOT authorize the call (regression for audit)', async () => {
  const client = makeRichClient({ callBehavior: 'requires-confirmation' })
  const tools = await glyphsAsVercelAiTools(client as any, {
    // Hook is now strictly boolean. A truthy string used to authorize; now rejects.
    onConfirmation: async () => 'reject' as unknown as boolean,
  })
  await assert.rejects(() => tools.send.execute({ to: 'a', body: 'b' }))
  assert.equal(client.callCount, 1)
})

test('onConfirmation returning true authorizes the call with the bound token', async () => {
  const client = makeRichClient({ callBehavior: 'requires-confirmation' })
  let receivedTicket: any = null
  const tools = await glyphsAsVercelAiTools(client as any, {
    onConfirmation: async (ticket) => {
      receivedTicket = ticket
      return true
    },
  })
  const out = await tools.send.execute({ to: 'a', body: 'b' })
  assert.equal(client.callCount, 2)
  assert.equal(client.calls[1].confirmationToken, 'real-ticket-token')
  assert.equal(receivedTicket.confirmationToken, 'real-ticket-token')
  assert.deepEqual(out, { ok: true, token: 'real-ticket-token' })
})

test('no onConfirmation hook propagates CONFIRMATION_REQUIRED', async () => {
  const client = makeRichClient({ callBehavior: 'requires-confirmation' })
  const tools = await glyphsAsVercelAiTools(client as any)
  await assert.rejects(() => tools.send.execute({ to: 'a', body: 'b' }))
  assert.equal(client.callCount, 1)
})
