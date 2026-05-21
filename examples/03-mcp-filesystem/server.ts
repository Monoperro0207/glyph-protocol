import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { glyphsFromMcpClient } from '@glyph/adapter-mcp'
import { GlyphServer } from '@glyph/server'

const exampleDir = dirname(fileURLToPath(import.meta.url))

// 1. Spawn the official MCP filesystem server and connect to it over stdio.
console.log('[mcp] starting @modelcontextprotocol/server-filesystem ...')
const transport = new StdioClientTransport({
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-filesystem', exampleDir],
})
const mcp = new Client({ name: 'glyph-mcp-adapter', version: '0.1.0' })
await mcp.connect(transport)
console.log('[mcp] connected')

// 2. Convert every real MCP tool into a glyph.
const glyphs = await glyphsFromMcpClient(mcp, { provider: 'mcp-filesystem' })
console.log(`[glyph] adapted ${glyphs.length} MCP tools into glyphs:`)
for (const glyph of glyphs) {
  console.log(`  [${glyph.card.cost.riskTier}] ${glyph.card.name}`)
}

// 3. Serve them over the Glyph protocol.
const server = new GlyphServer({ port: 3100 })
for (const glyph of glyphs) server.register(glyph)
await server.start()
