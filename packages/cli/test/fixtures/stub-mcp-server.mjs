// Minimal MCP stdio server used by import-mcp.test.ts to exercise the full
// runImportMcp success path deterministically (no network, no npx). It exposes
// two tools — one read-only/safe, one whose name (`delete_file`) trips the
// adapter's dangerous-word heuristic into riskTier "danger".
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const server = new McpServer({ name: 'stub-mcp-server', version: '0.0.1' })

server.registerTool(
  'list_files',
  {
    description: 'List files in a directory.',
    inputSchema: { path: z.string() },
    annotations: { readOnlyHint: true },
  },
  async ({ path }) => ({ content: [{ type: 'text', text: `listing ${path}` }] }),
)

server.registerTool(
  'delete_file',
  {
    description: 'Delete a file.',
    inputSchema: { path: z.string() },
    annotations: { destructiveHint: true },
  },
  async ({ path }) => ({ content: [{ type: 'text', text: `deleted ${path}` }] }),
)

await server.connect(new StdioServerTransport())
