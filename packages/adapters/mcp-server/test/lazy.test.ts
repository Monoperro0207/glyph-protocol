import { test } from 'node:test'
import assert from 'node:assert/strict'
import { z } from 'zod'
import { defineGlyph, GlyphServer } from '@glyphp/server'
import { GlyphClient } from '@glyphp/client'
import { mcpServerFromGlyphLazy } from '../src/lazy.js'

async function harness() {
  const server = new GlyphServer()
  server.register(
    defineGlyph({
      name: 'math.add',
      intent: 'Add two numbers',
      cost: {
        latency: 'fast',
        sideEffects: false,
        reversible: true,
        riskTier: 'safe',
        requiresConfirmation: false,
      },
      input: z.object({ a: z.number(), b: z.number() }),
      output: z.object({ sum: z.number() }),
      provider: 'test',
      handler: async ({ a, b }) => ({ sum: a + b }),
    })
  )
  server.register(
    defineGlyph({
      name: 'fs.delete',
      intent: 'Delete a file',
      cost: {
        latency: 'fast',
        sideEffects: true,
        reversible: false,
        riskTier: 'danger',
        requiresConfirmation: true,
      },
      input: z.object({ path: z.string() }),
      output: z.object({ ok: z.boolean() }),
      provider: 'test',
      handler: async () => ({ ok: true }),
    })
  )

  const client = new GlyphClient({
    baseUrl: 'http://glyph',
    fetch: server.fetch as typeof fetch,
  })
  await client.connect()

  const bridge = mcpServerFromGlyphLazy(client) as unknown as {
    _requestHandlers: Map<string, (req: unknown) => Promise<unknown>>
  }
  const handlers = bridge._requestHandlers
  const listHandler = handlers.get('tools/list')!
  const callHandler = handlers.get('tools/call')!

  return {
    callListTools: () => listHandler({ method: 'tools/list', params: {} }),
    callTool: (name: string, args: Record<string, unknown>) =>
      callHandler({
        method: 'tools/call',
        params: { name, arguments: args },
      }),
  }
}

test('lazy bridge exposes only 3 meta-tools regardless of glyph count', async () => {
  const h = await harness()
  const result = (await h.callListTools()) as {
    tools: Array<{ name: string }>
  }
  assert.equal(result.tools.length, 3)
  const names = result.tools.map((t) => t.name).sort()
  assert.deepEqual(names, ['glyph_describe', 'glyph_index', 'glyph_invoke'])
})

test('glyph_index returns name/intent/riskTier for every card', async () => {
  const h = await harness()
  const result = (await h.callTool('glyph_index', {})) as {
    content: Array<{ text: string }>
  }
  const parsed = JSON.parse(result.content[0].text) as Array<{
    name: string
    riskTier: string
  }>
  assert.equal(parsed.length, 2)
  const add = parsed.find((c) => c.name === 'math.add')
  assert.ok(add)
  assert.equal(add!.riskTier, 'safe')
})

test('glyph_describe returns the full card', async () => {
  const h = await harness()
  const result = (await h.callTool('glyph_describe', {
    name: 'math.add',
  })) as { content: Array<{ text: string }> }
  const parsed = JSON.parse(result.content[0].text)
  assert.equal(parsed.name, 'math.add')
  assert.ok(parsed.input)
  assert.ok(parsed.cost)
})

test('glyph_invoke executes the underlying tool', async () => {
  const h = await harness()
  const result = (await h.callTool('glyph_invoke', {
    name: 'math.add',
    arguments: { a: 2, b: 3 },
  })) as { content: Array<{ text: string }> }
  const payload = JSON.parse(result.content[0].text)
  assert.equal(payload.sum, 5)
})

test('glyph_invoke refuses confirmation-required tools', async () => {
  const h = await harness()
  const result = (await h.callTool('glyph_invoke', {
    name: 'fs.delete',
    arguments: { path: '/tmp/x' },
  })) as { isError?: boolean; content: Array<{ text: string }> }
  assert.equal(result.isError, true)
  assert.match(result.content[0].text, /requires confirmation/)
})

test('glyph_describe with unknown name returns isError', async () => {
  const h = await harness()
  const result = (await h.callTool('glyph_describe', {
    name: 'nope',
  })) as { isError?: boolean; content: Array<{ text: string }> }
  assert.equal(result.isError, true)
  assert.match(result.content[0].text, /unknown glyph/)
})
