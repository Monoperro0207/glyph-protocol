import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { glyphsFromMcpClient } from '@glyphp/adapter-mcp'
import type { GlyphDefinition } from '@glyphp/server'
import type { McpServerConfig } from './types.js'

/**
 * Connects to one MCP server, lists its tools, and converts them to Glyph
 * definitions using the existing `@glyphp/adapter-mcp`. Bounded by
 * `timeoutMs` so a hung server cannot stall the whole import run.
 *
 * Returns the glyph definitions (we never run the handlers here — those
 * land in the generated `server.ts`). The caller is responsible for
 * closing the transport, which we do in `finally`.
 */
export async function importOneServer(
  config: McpServerConfig,
  timeoutMs: number
): Promise<GlyphDefinition<any, any>[]> {
  if (config.transport.kind === 'http') {
    // HTTP/SSE transport isn't fully covered by the v1 of this importer —
    // the MCP SDK ships a separate transport for it, but the moving parts
    // (StreamableHTTP vs SSE) shift faster than we want to bake in. Surface
    // a clear error so the user can switch to stdio for now.
    throw new Error(
      'HTTP/SSE transport not yet wired in import-mcp v1 — use --command for stdio or stay tuned for v2.'
    )
  }
  const transport = new StdioClientTransport({
    command: config.transport.command,
    args: config.transport.args,
    env: {
      ...(process.env as Record<string, string>),
      ...(config.transport.env ?? {}),
    },
  })
  const client = new Client({ name: 'glyph-import-mcp', version: '0.1.0' })
  try {
    await withTimeout(client.connect(transport), timeoutMs, 'connect')
    const glyphs = await withTimeout(
      glyphsFromMcpClient(client, { provider: `mcp:${config.name}` }),
      timeoutMs,
      'listTools'
    )
    return glyphs
  } finally {
    try {
      await client.close()
    } catch {
      /* ignore close failures — connect or listTools already reported */
    }
  }
}

async function withTimeout<T>(
  p: Promise<T>,
  ms: number,
  stage: string
): Promise<T> {
  let to: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_, reject) => {
    to = setTimeout(() => reject(new Error(`${stage} timed out after ${ms}ms`)), ms)
  })
  try {
    return await Promise.race([p, timeout])
  } finally {
    if (to) clearTimeout(to)
  }
}
