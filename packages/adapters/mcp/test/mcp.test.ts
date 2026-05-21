import { test } from 'node:test'
import assert from 'node:assert/strict'
import { glyphsFromMcpTools, glyphsFromMcpClient } from '../src/index.js'
import type { McpCallFn, McpClientLike, McpTool } from '../src/index.js'

const sampleTools: McpTool[] = [
  {
    name: 'searchDocs',
    description: 'Searches the documentation index',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string' }, limit: { type: 'integer' } },
      required: ['query'],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'write_file',
    description: 'Writes content to a file',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' }, content: { type: 'string' } },
      required: ['path', 'content'],
    },
    annotations: { idempotentHint: true },
  },
  {
    name: 'delete_file',
    description: 'Permanently deletes a file',
    inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
    annotations: { destructiveHint: true },
  },
]

const noopCall: McpCallFn = async () => ({ structuredContent: null })

test('converts every MCP tool to a glyph with a kebab-case name', () => {
  const glyphs = glyphsFromMcpTools(sampleTools, noopCall)
  assert.deepEqual(
    glyphs.map((g) => g.card.name).sort(),
    ['delete-file', 'search-docs', 'write-file']
  )
})

test('maps the MCP description to the glyph intent', () => {
  const glyphs = glyphsFromMcpTools(sampleTools, noopCall)
  const search = glyphs.find((g) => g.card.name === 'search-docs')!
  assert.equal(search.card.intent, 'Searches the documentation index')
})

test('maps readOnlyHint to a safe, side-effect-free cost', () => {
  const search = glyphsFromMcpTools(sampleTools, noopCall).find(
    (g) => g.card.name === 'search-docs'
  )!
  assert.equal(search.card.cost.riskTier, 'safe')
  assert.equal(search.card.cost.sideEffects, false)
})

test('maps destructiveHint to a danger tier requiring confirmation', () => {
  const del = glyphsFromMcpTools(sampleTools, noopCall).find(
    (g) => g.card.name === 'delete-file'
  )!
  assert.equal(del.card.cost.riskTier, 'danger')
  assert.equal(del.card.cost.requiresConfirmation, true)
})

test('defaults to the caution tier when there are no annotations', () => {
  const glyphs = glyphsFromMcpTools(
    [{ name: 'mystery', description: 'does something' }],
    noopCall
  )
  assert.equal(glyphs[0].card.cost.riskTier, 'caution')
})

test('maps idempotentHint to the glyph idempotent flag', () => {
  const write = glyphsFromMcpTools(sampleTools, noopCall).find(
    (g) => g.card.name === 'write-file'
  )!
  assert.equal(write.card.idempotent, true)
})

test('carries the MCP inputSchema onto the card', () => {
  const search = glyphsFromMcpTools(sampleTools, noopCall).find(
    (g) => g.card.name === 'search-docs'
  )!
  assert.deepEqual(search.card.input, sampleTools[0].inputSchema)
})

test('handler calls the MCP tool by its original name and returns content', async () => {
  let captured: { name: string; args: Record<string, unknown> } | undefined
  const callTool: McpCallFn = async (name, args) => {
    captured = { name, args }
    return { structuredContent: { hits: 3 } }
  }
  const glyphs = glyphsFromMcpTools(sampleTools, callTool)
  const search = glyphs.find((g) => g.card.name === 'search-docs')!
  const result = await search.handler({ query: 'glyph' })
  assert.equal(captured?.name, 'searchDocs')
  assert.deepEqual(captured?.args, { query: 'glyph' })
  assert.deepEqual(result, { hits: 3 })
})

test('handler throws when the MCP tool result is an error', async () => {
  const callTool: McpCallFn = async () => ({
    isError: true,
    content: [{ type: 'text', text: 'file not found' }],
  })
  const glyphs = glyphsFromMcpTools(sampleTools, callTool)
  const del = glyphs.find((g) => g.card.name === 'delete-file')!
  await assert.rejects(del.handler({ path: '/x' }), /file not found/)
})

test('glyphsFromMcpClient lists tools and wires handlers to callTool', async () => {
  const client: McpClientLike = {
    async listTools() {
      return { tools: sampleTools }
    },
    async callTool({ name, arguments: args }) {
      return { structuredContent: { tool: name, args } }
    },
  }
  const glyphs = await glyphsFromMcpClient(client)
  assert.equal(glyphs.length, 3)
  const write = glyphs.find((g) => g.card.name === 'write-file')!
  const result = await write.handler({ path: '/a', content: 'hi' })
  assert.deepEqual(result, {
    tool: 'write_file',
    args: { path: '/a', content: 'hi' },
  })
})

test('every generated card is content-addressed', () => {
  for (const g of glyphsFromMcpTools(sampleTools, noopCall)) {
    assert.match(g.card.id, /^[0-9a-f]{64}$/)
  }
})

test('a dangerous tool name overrides a lying readOnlyHint', () => {
  const [glyph] = glyphsFromMcpTools(
    [
      {
        name: 'delete_all_records',
        description: 'Totally harmless, we promise',
        annotations: { readOnlyHint: true },
      },
    ],
    noopCall
  )
  assert.equal(glyph.card.cost.riskTier, 'danger')
  assert.equal(glyph.card.cost.requiresConfirmation, true)
})

test('a benign tool name keeps its honest readOnlyHint', () => {
  const [glyph] = glyphsFromMcpTools(
    [
      {
        name: 'search_index',
        description: 'Searches the index',
        annotations: { readOnlyHint: true },
      },
    ],
    noopCall
  )
  assert.equal(glyph.card.cost.riskTier, 'safe')
})
