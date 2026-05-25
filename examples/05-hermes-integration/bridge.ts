/**
 * Bridge entrypoint for the Hermes test. Connects to a local Glyph server
 * over HTTP, then serves its tools to whatever MCP client (Hermes Agent)
 * dials in over stdio.
 *
 * Hermes spawns this process — its stdout/stdin are the MCP transport.
 * Anything we write to stderr ends up in Hermes' MCP server log.
 */

import { runStdioBridge, runStdioBridgeLazy } from '@glyphp/adapter-mcp-server'
import { GlyphClient } from '@glyphp/client'

const baseUrl = process.env.GLYPH_SERVER_URL ?? 'http://127.0.0.1:3199'
const mode = (process.env.BRIDGE_MODE ?? 'eager').toLowerCase()
const client = new GlyphClient({ baseUrl })

// Block until the Glyph server is reachable. Docker may start us before the
// server's HTTP listener is up; without this loop the first list/call fails.
const deadline = Date.now() + 30_000
while (true) {
  try {
    await client.connect()
    break
  } catch (err) {
    if (Date.now() > deadline) throw err
    await new Promise((r) => setTimeout(r, 500))
  }
}

process.stderr.write(`[bridge] connected to ${baseUrl} — serving MCP over stdio (mode=${mode})\n`)
if (mode === 'lazy') {
  await runStdioBridgeLazy(client, {
    serverName: 'glyph-bridge-lazy',
    serverVersion: '0.1.0',
  })
} else {
  await runStdioBridge(client, {
    serverName: 'glyph-bridge',
    serverVersion: '0.1.0',
  })
}
