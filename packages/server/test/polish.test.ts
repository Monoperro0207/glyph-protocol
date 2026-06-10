import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { z } from 'zod'
import { defineGlyph, type GlyphLogger, GlyphServer, MemoryDedupeStore } from '../src/index.js'

const pkgVersion: string = createRequire(import.meta.url)('../package.json').version

let counterCalls = 0
const makeCounter = () =>
  defineGlyph({
    name: 'counter',
    intent: 'Counts how many times the handler really ran',
    cost: {
      latency: 'fast',
      sideEffects: true,
      reversible: true,
      riskTier: 'safe',
      requiresConfirmation: false,
    },
    input: z.object({ step: z.number() }),
    output: z.object({ calls: z.number() }),
    provider: 'test',
    handler: async () => ({ calls: ++counterCalls }),
  })

const callBody = (callId: string, step = 1) =>
  new Request('http://glyph/glyphs/counter/call', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ input: { step }, callId }),
  })

test('/health reports the real package version, not a hardcoded one', async () => {
  const server = new GlyphServer()
  const res = await server.fetch(new Request('http://glyph/health'))
  const health = await res.json()
  assert.equal(health.version, pkgVersion)
})

test('an injected logger receives the startup notice instead of console', () => {
  const lines: string[] = []
  const logger: GlyphLogger = {
    info: (msg, ...args) => lines.push(`info ${msg} ${args.join(' ')}`),
    warn: (msg) => lines.push(`warn ${msg}`),
    error: (msg) => lines.push(`error ${msg}`),
  }
  new GlyphServer({ logger })
  assert.ok(
    lines.some((l) => l.startsWith('info') && l.includes('publicKey')),
    `startup notice went to the injected logger: ${lines.join(' | ')}`,
  )
})

test('dedupeByClientCallId replays the recorded response without re-running the handler', async () => {
  counterCalls = 0
  const server = new GlyphServer({ dedupeByClientCallId: {} }).register(makeCounter())

  const first = await (await server.fetch(callBody('req-1'))).json()
  const retry = await (await server.fetch(callBody('req-1'))).json()
  assert.equal(first.payload.calls, 1)
  assert.deepEqual(retry, first, 'retry replays the exact recorded response')
  assert.equal(counterCalls, 1, 'handler ran exactly once')

  // Same callId but different input is a different request, not a retry.
  const different = await (await server.fetch(callBody('req-1', 2))).json()
  assert.equal(different.payload.calls, 2)
})

test('without dedupeByClientCallId, a repeated callId re-executes (current default)', async () => {
  counterCalls = 0
  const server = new GlyphServer().register(makeCounter())
  await server.fetch(callBody('req-1'))
  await server.fetch(callBody('req-1'))
  assert.equal(counterCalls, 2)
})

test('a shared DedupeStore deduplicates across replicas', async () => {
  counterCalls = 0
  const store = new MemoryDedupeStore()
  const replicaA = new GlyphServer({ dedupeByClientCallId: { store } }).register(makeCounter())
  const replicaB = new GlyphServer({ dedupeByClientCallId: { store } }).register(makeCounter())

  const first = await (await replicaA.fetch(callBody('req-9'))).json()
  const retry = await (await replicaB.fetch(callBody('req-9'))).json()
  assert.deepEqual(retry, first)
  assert.equal(counterCalls, 1)
})
