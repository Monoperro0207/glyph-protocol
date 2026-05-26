import assert from 'node:assert/strict'
import { test } from 'node:test'
import { GlyphClient } from '@glyphp/client'
import { defineGlyph, GlyphServer } from '@glyphp/server'
import { z } from 'zod'
import { mcpServerFromGlyph } from '../src/index.js'

/**
 * Builds a Glyph server with a fixed set of tools, a Glyph client wired into
 * it via in-process fetch (no network), and the MCP bridge over that client.
 * Returns helpers to invoke MCP request handlers as if we were the transport.
 */
async function harness(): Promise<{
  callListTools: () => Promise<unknown>
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>
}> {
  const server = new GlyphServer()
  server.register(
    defineGlyph({
      name: 'add',
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
      name: 'delete-all',
      intent: 'Delete everything',
      cost: {
        latency: 'fast',
        sideEffects: true,
        reversible: false,
        riskTier: 'danger',
        requiresConfirmation: true,
      },
      input: z.object({ confirm: z.literal('yes') }),
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

  const bridge = mcpServerFromGlyph(client) as unknown as {
    _requestHandlers: Map<string, (req: unknown) => Promise<unknown>>
  }
  // The MCP SDK exposes handlers by request schema "method" string. We pull
  // them out and call them directly — that's the same path the stdio
  // transport takes, minus the JSON-RPC framing.
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

test('the bridge lists every glyph tool as an MCP tool', async () => {
  const h = await harness()
  const result = (await h.callListTools()) as {
    tools: Array<{ name: string; description: string; inputSchema: unknown }>
  }
  const names = result.tools.map((t) => t.name).sort()
  assert.deepEqual(names, ['add', 'delete-all'])
  // The input schema is preserved verbatim from the glyph card.
  const add = result.tools.find((t) => t.name === 'add')
  assert.ok(add?.inputSchema)
})

test('a safe tool call round-trips the payload', async () => {
  const h = await harness()
  const result = (await h.callTool('add', { a: 2, b: 3 })) as {
    content: Array<{ type: string; text: string }>
  }
  // The MCP content carries the JSON-serialized payload.
  assert.ok(result.content[0]?.text.includes('"sum"'))
  assert.ok(result.content[0]?.text.includes('5'))
})

test('a danger tool surfaces its risk tier in the MCP description', async () => {
  const h = await harness()
  const result = (await h.callListTools()) as {
    tools: Array<{ name: string; description: string }>
  }
  const danger = result.tools.find((t) => t.name === 'delete-all')!
  assert.match(danger.description, /risk: danger/)
  assert.match(danger.description, /side effects/)
  assert.match(danger.description, /not reversible/)
  assert.match(danger.description, /requires confirmation/)
})

test('a confirmation-required tool is refused at the bridge — MCP has no ticket flow', async () => {
  const h = await harness()
  const result = (await h.callTool('delete-all', { confirm: 'yes' })) as {
    isError: boolean
    content: Array<{ type: string; text: string }>
  }
  assert.equal(result.isError, true)
  assert.match(result.content[0]?.text, /requires confirmation/i)
  assert.match(result.content[0]?.text, /native Glyph client/i)
})

test('tool names with dots are normalized for MCP and round-trip via alias', async () => {
  // Re-build a server with a dotted name to test the alias mapping. OpenAI/
  // DeepSeek require ^[a-zA-Z0-9_-]+$ — `fs.read` must surface as `fs_read`
  // on tools/list, and `tools/call({name: "fs_read"})` must hit the original.
  const server = new GlyphServer()
  server.register(
    defineGlyph({
      name: 'fs.read',
      intent: 'Read a file',
      cost: {
        latency: 'fast',
        sideEffects: false,
        reversible: true,
        riskTier: 'safe',
        requiresConfirmation: false,
      },
      input: z.object({ path: z.string() }),
      output: z.object({ bytes: z.number() }),
      provider: 'test',
      handler: async ({ path }) => ({ bytes: path.length }),
    }),
  )
  const client = new GlyphClient({
    baseUrl: 'http://glyph',
    fetch: server.fetch as typeof fetch,
  })
  await client.connect()
  const { mcpServerFromGlyph } = await import('../src/index.js')
  const bridge = mcpServerFromGlyph(client) as unknown as {
    _requestHandlers: Map<string, (req: unknown) => Promise<unknown>>
  }
  const listHandler = bridge._requestHandlers.get('tools/list')!
  const callHandler = bridge._requestHandlers.get('tools/call')!

  const listed = (await listHandler({ method: 'tools/list', params: {} })) as {
    tools: Array<{ name: string }>
  }
  assert.equal(listed.tools[0]?.name, 'fs_read')

  const called = (await callHandler({
    method: 'tools/call',
    params: { name: 'fs_read', arguments: { path: 'hello.txt' } },
  })) as { content: Array<{ type: string; text: string }> }
  assert.ok(called.content[0]?.text.includes('"bytes"'))
  assert.ok(called.content[0]?.text.includes('9'))
})

test('an unknown tool returns an MCP error', async () => {
  const h = await harness()
  const result = (await h.callTool('does-not-exist', {})) as {
    isError: boolean
    content: Array<{ type: string; text: string }>
  }
  assert.equal(result.isError, true)
  assert.match(result.content[0]?.text, /Unknown Glyph tool/)
})

test('MCP name collision — two glyphs normalizing to same name', async () => {
  const server = new GlyphServer()
  server.register(
    defineGlyph({
      name: 'my.tool',
      intent: 'First',
      cost: { latency: 'fast', sideEffects: false, reversible: true, riskTier: 'safe', requiresConfirmation: false },
      input: z.object({}),
      output: z.any(),
      provider: 'test',
      handler: async () => ({}),
    }),
  )
  server.register(
    defineGlyph({
      name: 'my-tool',
      intent: 'Second',
      cost: { latency: 'fast', sideEffects: false, reversible: true, riskTier: 'safe', requiresConfirmation: false },
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
  // mcpServerFromGlyph should throw at tools/list time because my.tool
  // and my-tool both normalize to my_tool via sanitizeMcpName.
  // The collision is detected in loadCards() during alias registration.
  assert.throws(() => {
    mcpServerFromGlyph(client)
  }, /MCP name collision/)
})

test('glyph call that throws is caught and returned as MCP error', async () => {
  const server = new GlyphServer()
  server.register(
    defineGlyph({
      name: 'boom',
      intent: 'Will throw',
      cost: { latency: 'fast', sideEffects: false, reversible: true, riskTier: 'safe', requiresConfirmation: false },
      input: z.object({}),
      output: z.any(),
      provider: 'test',
      handler: async () => { throw new Error('deliberate') },
    }),
  )
  const client = new GlyphClient({
    baseUrl: 'http://glyph',
    fetch: server.fetch as typeof fetch,
  })
  await client.connect()
  const bridge = mcpServerFromGlyph(client) as unknown as {
    _requestHandlers: Map<string, (req: unknown) => Promise<unknown>>
  }
  const callHandler = bridge._requestHandlers.get('tools/call')!
  const result = await callHandler({
    method: 'tools/call',
    params: { name: 'boom', arguments: {} },
  })
  assert.equal(result.isError, true)
  assert.match(result.content[0].text, /Glyph call failed/)
  assert.match(result.content[0].text, /deliberate/)
})

test('lexicon is cached across multiple tools/list calls', async () => {
  const h = await harness()
  const r1 = (await h.callListTools()) as { tools: Array<{ name: string }> }
  const r2 = (await h.callListTools()) as { tools: Array<{ name: string }> }
  assert.deepEqual(r1.tools.map(t => t.name), r2.tools.map(t => t.name))
  assert.equal(r1.tools.length, 2)
})

test('glyph with string output payload is handled', async () => {
  const server = new GlyphServer()
  server.register(
    defineGlyph({
      name: 'txt',
      intent: 'Returns string',
      cost: { latency: 'fast', sideEffects: false, reversible: true, riskTier: 'safe', requiresConfirmation: false },
      input: z.object({}),
      output: z.string(),
      provider: 'test',
      handler: async () => 'just text',
    }),
  )
  const client = new GlyphClient({
    baseUrl: 'http://glyph',
    fetch: server.fetch as typeof fetch,
  })
  await client.connect()
  const bridge = mcpServerFromGlyph(client) as unknown as {
    _requestHandlers: Map<string, (req: unknown) => Promise<unknown>>
  }
  const callHandler = bridge._requestHandlers.get('tools/call')!
  const result = await callHandler({
    method: 'tools/call',
    params: { name: 'txt', arguments: {} },
  })
  assert.ok(result.content[0].text.includes('just text'))
  assert.ok(!result.isError)
})

test('sanitized output appends inspection note to MCP content', async () => {
  const server = new GlyphServer()
  server.register(
    defineGlyph({
      name: 'invisible',
      intent: 'Returns string with hidden chars',
      cost: { latency: 'fast', sideEffects: false, reversible: true, riskTier: 'safe', requiresConfirmation: false },
      input: z.object({}),
      output: z.string(),
      provider: 'test',
      handler: async () => 'hello\u200Bworld', // zero-width space
    }),
  )
  const client = new GlyphClient({
    baseUrl: 'http://glyph',
    fetch: server.fetch as typeof fetch,
  })
  await client.connect()
  const bridge = mcpServerFromGlyph(client) as unknown as {
    _requestHandlers: Map<string, (req: unknown) => Promise<unknown>>
  }
  const callHandler = bridge._requestHandlers.get('tools/call')!
  const result = await callHandler({
    method: 'tools/call',
    params: { name: 'invisible', arguments: {} },
  })
  assert.ok(result.content[0].text.includes('hello'))
  const sanitizedNote = result.content.find((b: any) => b.text.includes('[glyph: sanitized'))
  assert.ok(sanitizedNote, 'expected sanitization note')
})
