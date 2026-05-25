import assert from 'node:assert/strict'
import { test } from 'node:test'
import { PROTOCOL_VERSION } from '@glyphp/types'
import { z } from 'zod'
import { defineGlyph, GlyphServer } from '../src/index.js'

const server = new GlyphServer()
server.register(
  defineGlyph({
    name: 'noop',
    intent: 'Does nothing',
    cost: {
      latency: 'fast',
      sideEffects: false,
      reversible: true,
      riskTier: 'safe',
      requiresConfirmation: false,
    },
    input: z.object({}),
    output: z.object({}),
    provider: 'test',
    handler: async () => ({}),
  }),
)

async function handshake(body: unknown) {
  const res = await server.fetch(
    new Request('http://glyph/handshake', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
  return { status: res.status, body: (await res.json()) as any }
}

const baseRequest = {
  consumerId: 'c1',
  contextBudget: 50000,
  preferredCardDepth: 'standard',
}

test('handshake with the supported protocol version succeeds', async () => {
  const res = await handshake({ protocolVersion: PROTOCOL_VERSION, ...baseRequest })
  assert.equal(res.status, 200)
  assert.equal(res.body.protocolVersion, PROTOCOL_VERSION)
  assert.ok(res.body.sessionId)
})

test('handshake with an unsupported protocol version → 426', async () => {
  const res = await handshake({ protocolVersion: '99.0', ...baseRequest })
  assert.equal(res.status, 426)
  assert.equal(res.body.error.code, 'PROTOCOL_VERSION_UNSUPPORTED')
  assert.equal(res.body.error.details.serverProtocolVersion, PROTOCOL_VERSION)
  assert.equal(res.body.error.details.clientProtocolVersion, '99.0')
})

test('handshake with no protocol version → 426', async () => {
  const res = await handshake(baseRequest)
  assert.equal(res.status, 426)
  assert.equal(res.body.error.code, 'PROTOCOL_VERSION_UNSUPPORTED')
  assert.equal(res.body.error.details.clientProtocolVersion, null)
})

test('/health reports the protocol version', async () => {
  const res = await server.fetch(new Request('http://glyph/health'))
  const body = (await res.json()) as any
  assert.equal(body.ok, true)
  assert.equal(body.protocolVersion, PROTOCOL_VERSION)
})
