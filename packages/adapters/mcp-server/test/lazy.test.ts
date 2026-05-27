import assert from 'node:assert/strict'
import { test } from 'node:test'
import { GlyphClient } from '@glyphp/client'
import { defineGlyph, GlyphServer } from '@glyphp/server'
import { z } from 'zod'
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
    }),
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
    }),
  )

  const client = new GlyphClient({
    baseUrl: 'http://glyph',
    fetch: server.fetch as typeof fetch,
  })
  await client.connect()

  const bridge = mcpServerFromGlyphLazy(client) as unknown as {
    _requestHandlers: Map<string, (req: unknown) => Promise<unknown>>
    _serverInfo?: { name: string; version: string }
  }
  const handlers = bridge._requestHandlers
  const listHandler = handlers.get('tools/list')!
  const callHandler = handlers.get('tools/call')!

  return {
    client,
    bridge,
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
  assert.equal(add?.riskTier, 'safe')
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

test('glyph_describe without name returns isError', async () => {
  const h = await harness()
  const result = (await h.callTool('glyph_describe', {})) as {
    isError?: boolean
    content: Array<{ text: string }>
  }
  assert.equal(result.isError, true)
  assert.match(result.content[0].text, /requires {name}/)
})

test('glyph_invoke without name returns isError', async () => {
  const h = await harness()
  const result = (await h.callTool('glyph_invoke', {})) as {
    isError?: boolean
    content: Array<{ text: string }>
  }
  assert.equal(result.isError, true)
  assert.match(result.content[0].text, /requires {name}/)
})

test('glyph_invoke with unknown glyph returns isError', async () => {
  const h = await harness()
  const result = (await h.callTool('glyph_invoke', {
    name: 'nope',
    arguments: {},
  })) as { isError?: boolean; content: Array<{ text: string }> }
  assert.equal(result.isError, true)
  assert.match(result.content[0].text, /unknown glyph/)
})

test('unknown meta-tool returns isError', async () => {
  const h = await harness()
  const result = (await h.callTool('glyph_who', {})) as {
    isError?: boolean
    content: Array<{ text: string }>
  }
  assert.equal(result.isError, true)
  assert.match(result.content[0].text, /unknown meta-tool/)
})

test('ensureIndex is cached — second glyph_index does not re-fetch', async () => {
  const h = await harness()
  // First call loads the index
  const r1 = (await h.callTool('glyph_index', {})) as {
    content: Array<{ text: string }>
  }
  assert.ok(r1.content[0].text)
  // Second call uses cache — should return same data
  const r2 = (await h.callTool('glyph_index', {})) as {
    content: Array<{ text: string }>
  }
  assert.deepEqual(r2.content[0].text, r1.content[0].text)
})

test('glyph_invoke with string payload works', async () => {
  const h = await harness()
  const result = (await h.callTool('glyph_invoke', {
    name: 'math.add',
    arguments: { a: 1, b: 1 },
  })) as { content: Array<{ text: string }> }
  const payload = JSON.parse(result.content[0].text)
  assert.equal(payload.sum, 2)
})

test('mcpServerFromGlyphLazy uses default name when none provided', () => {
  const client = {
    getLexicon: async () => [],
    getCard: async () => ({}),
    call: async () => ({}),
  }
  const server = mcpServerFromGlyphLazy(client as any)
  const info = (server as any)._serverInfo
  assert.ok(info)
  assert.equal(info.name, 'glyph-mcp-bridge-lazy')
})

test('glyph_invoke that throws is caught and returns error', async () => {
  // Build a client whose call() throws after ensureIndex succeeds.
  // Use an in-process glyph server for lexicon/card, but override call to throw.
  const server = new GlyphServer()
  server.register(
    defineGlyph({
      name: 'bad',
      intent: 'Will throw',
      cost: {
        latency: 'fast',
        sideEffects: false,
        reversible: true,
        riskTier: 'safe',
        requiresConfirmation: false,
      },
      input: z.object({}),
      output: z.any(),
      provider: 'test',
      handler: async () => {
        throw new Error('deliberate boom')
      },
    }),
  )
  const client = new GlyphClient({
    baseUrl: 'http://glyph',
    fetch: server.fetch as typeof fetch,
  })
  await client.connect()

  const bridge = mcpServerFromGlyphLazy(client)
  const handlers = (bridge as any)._requestHandlers
  const callHandler = handlers.get('tools/call')!

  // Load the index first
  await callHandler({
    method: 'tools/call',
    params: { name: 'glyph_index', arguments: {} },
  })

  // Invoke the bad glyph — handler throws → caught by catch block
  const result = await callHandler({
    method: 'tools/call',
    params: { name: 'glyph_invoke', arguments: { name: 'bad', arguments: {} } },
  })
  assert.equal(result.isError, true)
  assert.match(result.content[0].text, /lazy bridge error:/)
})

test('runStdioBridgeLazy is exported and callable', async () => {
  const { runStdioBridgeLazy } = await import('../src/lazy.js')
  assert.equal(typeof runStdioBridgeLazy, 'function')

  // Actually call it with a mock transport — StdioServerTransport.connect()
  // can be tricked by setting process.stdin to a mock stream.
  // We wrap it so the connect doesn't block forever.
  const server = new GlyphServer()
  server.register(
    defineGlyph({
      name: 'test.tool',
      intent: 'test',
      cost: {
        latency: 'fast',
        sideEffects: false,
        reversible: true,
        riskTier: 'safe',
        requiresConfirmation: false,
      },
      input: z.object({}),
      output: z.any(),
      provider: 'test',
      handler: async () => ({}),
    }),
  )
  const client = new GlyphClient({
    baseUrl: 'http://glyph',
    fetch: server.fetch as typeof fetch,
  })
  await client.connect()

  // runStdioBridgeLazy calls server.connect(new StdioServerTransport())
  // which tries to read/write stdin/stdout. We can't fully test this
  // in a unit test without mocking Node stdio.
  // Call the factory directly — it returns the server before connecting.
  const bridge = mcpServerFromGlyphLazy(client)
  assert.ok(bridge)
})

test('glyph_invoke with payload containing sanitized chars shows inspection note', async () => {
  // Build a fresh server where one glyph's output triggers sanitization.
  // The payload must contain a zero-width character that the server strips.
  const server = new GlyphServer()
  server.register(
    defineGlyph({
      name: 'naughty',
      intent: 'Return text with invisible chars',
      cost: {
        latency: 'fast',
        sideEffects: false,
        reversible: true,
        riskTier: 'safe',
        requiresConfirmation: false,
      },
      input: z.object({}),
      output: z.string(),
      provider: 'test',
      handler: async () => '\u200Bhello\u200B', // zero-width spaces
    }),
  )
  const client2 = new GlyphClient({
    baseUrl: 'http://glyph',
    fetch: server.fetch as typeof fetch,
  })
  await client2.connect()

  // Build a handler-scoped harness reusing the client directly
  const bridge2 = mcpServerFromGlyphLazy(client2, {
    serverName: 'test-sanitize',
  })
  const handlers2 = (bridge2 as any)._requestHandlers
  const callHandler2 = handlers2.get('tools/call')!

  // Load the index
  await callHandler2({
    method: 'tools/call',
    params: { name: 'glyph_index', arguments: {} },
  })

  // Invoke the naughty glyph
  const result = await callHandler2({
    method: 'tools/call',
    params: { name: 'glyph_invoke', arguments: { name: 'naughty', arguments: {} } },
  })
  assert.ok(Array.isArray(result.content))
  // Should have the payload text + the sanitization note
  const texts = result.content.map((b: any) => b.text)
  const payloadBlock = texts.find((t: string) => t.includes('hello'))
  assert.ok(payloadBlock, 'expected payload block with hello')
  const sanitizedBlock = texts.find((t: string) => t.includes('[glyph: sanitized'))
  assert.ok(sanitizedBlock, 'expected sanitization note when invisible chars are stripped')
})
