import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import type { GlyphDefinition } from '@glyphp/server'
import type { GlyphCard } from '@glyphp/types'
import { parseClaudeDesktopJson } from '../src/commands/import-mcp/clients/claude-desktop.js'
import { parseCodexToml } from '../src/commands/import-mcp/clients/codex.js'
import { cursorAdapter } from '../src/commands/import-mcp/clients/cursor.js'
import { hermesAgentAdapter } from '../src/commands/import-mcp/clients/hermes-agent.js'
import { openclawAdapter } from '../src/commands/import-mcp/clients/openclaw.js'
import { emitServerProject, emitTopLevelIndex } from '../src/commands/import-mcp/emitter.js'
import { runImportMcp } from '../src/commands/import-mcp/index.js'
import { manualConfig } from '../src/commands/import-mcp/manual.js'
import { emitReport } from '../src/commands/import-mcp/report.js'

test('parseClaudeDesktopJson handles a standard config', () => {
  const raw = JSON.stringify({
    mcpServers: {
      filesystem: {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
      },
      notion: {
        command: 'npx',
        args: ['-y', '@notionhq/notion-mcp-server'],
        env: { NOTION_API_KEY: 'secret-not-copied' },
      },
    },
  })
  const out = parseClaudeDesktopJson(raw, 'claude-desktop')
  assert.equal(out.length, 2)
  const fs = out.find((s) => s.name === 'filesystem')!
  assert.equal(fs.source, 'claude-desktop')
  assert.equal(fs.transport.kind, 'stdio')
  if (fs.transport.kind === 'stdio') {
    assert.equal(fs.transport.command, 'npx')
    assert.deepEqual(fs.transport.args, ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'])
  }
  const notion = out.find((s) => s.name === 'notion')!
  assert.deepEqual(notion.transport.kind === 'stdio' ? notion.transport.env : undefined, {
    NOTION_API_KEY: 'secret-not-copied',
  })
})

test('parseClaudeDesktopJson silently skips malformed entries instead of throwing', () => {
  const raw = JSON.stringify({
    mcpServers: {
      good: { command: 'npx', args: ['-y', 'something'] },
      bad: { args: ['no command field'] },
      worse: 'not even an object',
    },
  })
  const out = parseClaudeDesktopJson(raw, 'claude-desktop')
  assert.equal(out.length, 1)
  assert.equal(out[0]?.name, 'good')
})

test('parseClaudeDesktopJson rejects invalid JSON loudly', () => {
  assert.throws(() => parseClaudeDesktopJson('{ not valid', 'claude-desktop'), /failed to parse/)
})

test('parseCodexToml reads [mcp_servers.<name>] tables', () => {
  const raw = `
[mcp_servers.fs]
command = "npx"
args = ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]

[mcp_servers.fs.env]
HOME = "/tmp"

[mcp_servers.api]
url = "https://example.com/mcp"
bearer_token = "tok"
`
  const out = parseCodexToml(raw)
  assert.equal(out.length, 2)
  const fs = out.find((s) => s.name === 'fs')!
  assert.equal(fs.source, 'codex')
  if (fs.transport.kind === 'stdio') {
    assert.equal(fs.transport.command, 'npx')
    assert.deepEqual(fs.transport.env, { HOME: '/tmp' })
  } else {
    assert.fail('expected stdio')
  }
  const api = out.find((s) => s.name === 'api')!
  if (api.transport.kind === 'http') {
    assert.equal(api.transport.url, 'https://example.com/mcp')
    assert.equal(api.transport.bearerToken, 'tok')
  } else {
    assert.fail('expected http')
  }
})

test('manualConfig builds a stdio config from --command', () => {
  const c = manualConfig({ command: 'npx -y @modelcontextprotocol/server-everything' })
  assert.equal(c.source, 'manual')
  if (c.transport.kind === 'stdio') {
    assert.equal(c.transport.command, 'npx')
    assert.deepEqual(c.transport.args, ['-y', '@modelcontextprotocol/server-everything'])
  } else {
    assert.fail('expected stdio')
  }
})

test('manualConfig builds an http config from --url', () => {
  const c = manualConfig({ url: 'https://mcp.example.com/sse', bearerToken: 'x' })
  if (c.transport.kind === 'http') {
    assert.equal(c.transport.url, 'https://mcp.example.com/sse')
    assert.equal(c.transport.bearerToken, 'x')
  } else {
    assert.fail('expected http')
  }
})

test('manualConfig throws when neither command nor url is set', () => {
  assert.throws(() => manualConfig({}), /pass either --command or --url/)
})

function fakeGlyph(
  name: string,
  riskTier: 'safe' | 'caution' | 'danger',
): GlyphDefinition<any, any> {
  const card: GlyphCard = {
    id: `gid:${name}`,
    version: '1.0.0',
    name,
    intent: `do ${name}`,
    tags: ['mcp'],
    cost: {
      latency: 'fast',
      sideEffects: riskTier !== 'safe',
      reversible: riskTier === 'safe',
      riskTier,
      requiresConfirmation: riskTier === 'danger',
    },
    idempotent: false,
    input: { type: 'object' },
    output: {},
    examples: [],
    failureModes: [],
    provider: 'test',
    createdAt: new Date().toISOString(),
  }
  return {
    card,
    inputSchema: { parse: (x: unknown) => x } as any,
    outputSchema: { parse: (x: unknown) => x } as any,
    handler: async () => ({}),
  }
}

test('emitServerProject writes server.ts, package.json, .env.example and README', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'glyph-import-test-'))
  try {
    const config = {
      name: 'fs-test',
      source: 'claude-desktop' as const,
      transport: {
        kind: 'stdio' as const,
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
        env: { NEEDS_TOKEN: 'value' },
      },
    }
    const glyphs = [fakeGlyph('list', 'safe'), fakeGlyph('delete-file', 'danger')]
    const result = await emitServerProject(config, glyphs, 3100, tmp)
    assert.equal(result.toolCount, 2)

    const serverTs = await readFile(join(tmp, 'server.ts'), 'utf8')
    assert.match(serverTs, /StdioClientTransport/)
    assert.match(serverTs, /"npx"/)
    assert.match(serverTs, /port:\s*3100/)
    assert.match(serverTs, /NEEDS_TOKEN/)

    const pkg = JSON.parse(await readFile(join(tmp, 'package.json'), 'utf8'))
    assert.match(pkg.name, /glyph-bridge-fs-test/)
    assert.ok(pkg.dependencies['@glyphp/adapter-mcp'])

    const env = await readFile(join(tmp, '.env.example'), 'utf8')
    assert.match(env, /^NEEDS_TOKEN=$/m)
    assert.doesNotMatch(env, /value/, 'env values must NOT be copied to .env.example')

    const readme = await readFile(join(tmp, 'README.md'), 'utf8')
    assert.match(readme, /delete-file.*danger/)
    assert.match(readme, /Review before production/)
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})

test('emitReport summarises imported + skipped + cards-to-review', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'glyph-report-test-'))
  try {
    const path = await emitReport(tmp, {
      imported: [
        {
          config: {
            name: 'fs',
            source: 'claude-desktop',
            transport: { kind: 'stdio', command: 'npx' },
          },
          port: 3100,
          toolCount: 2,
          outputDir: 'out/fs',
          cards: [
            { name: 'list', riskTier: 'safe', requiresConfirmation: false },
            { name: 'delete', riskTier: 'danger', requiresConfirmation: true },
          ],
        },
      ],
      skipped: [
        {
          config: {
            name: 'notion',
            source: 'claude-desktop',
            transport: { kind: 'stdio', command: 'npx' },
          },
          reason: 'missing env NOTION_API_KEY',
        },
      ],
    })
    const md = await readFile(path, 'utf8')
    assert.match(md, /Imported \(1\)/)
    assert.match(md, /Skipped \(1\)/)
    assert.match(md, /fs\.delete.*danger/)
    assert.match(md, /missing env NOTION_API_KEY/)
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})

test('runImportMcp with a failing manual command skips + reports without aborting', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'glyph-import-fail-'))
  try {
    const result = await runImportMcp({
      manual: { command: `/nonexistent/binary-${Math.random()}` },
      options: { output: tmp, portBase: 3100, dryRun: false, timeoutMs: 2_000 },
    })
    assert.equal(result.imported.length, 0)
    assert.equal(result.skipped.length, 1)
    assert.ok(result.reportPath)
    const md = await readFile(result.reportPath!, 'utf8')
    assert.match(md, /Skipped \(1\)/)
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})

test('runImportMcp --dry-run writes nothing and returns empty arrays', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'glyph-dryrun-'))
  try {
    const result = await runImportMcp({
      manual: { command: 'npx -y @modelcontextprotocol/server-everything' },
      options: { output: tmp, portBase: 3100, dryRun: true, timeoutMs: 2_000 },
    })
    assert.equal(result.imported.length, 0)
    assert.equal(result.skipped.length, 0)
    // No files should exist in tmp.
    const fs = await import('node:fs/promises')
    const entries = await fs.readdir(tmp)
    assert.equal(
      entries.length,
      0,
      `dry-run should not write anything, found: ${entries.join(',')}`,
    )
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// parseCodexToml edge cases
// ---------------------------------------------------------------------------

test('parseCodexToml rejects malformed TOML', () => {
  assert.throws(() => parseCodexToml('[mcp_servers\n  bad ='), /failed to parse codex config/)
})

test('parseCodexToml silently skips non-object MCP entries', () => {
  const out = parseCodexToml(`
[mcp_servers.ok]
command = "echo"

not_a_table = "nope"

[mcp_servers.bare_string]
mcp_servers.bare_string = "just a string, not a table"
`)
  assert.equal(out.length, 1)
  assert.equal(out[0]?.name, 'ok')
})

test('parseCodexToml skips entries without command or url', () => {
  const out = parseCodexToml(`
[mcp_servers.orphan]
args = ["--flag"]
`)
  assert.equal(out.length, 0)
})

test('parseCodexToml filters non-string env values', () => {
  const out = parseCodexToml(`
[mcp_servers.fs]
command = "npx"

[mcp_servers.fs.env]
TOKEN = "secret"
PORT = 3000
`)
  const o = out[0]!
  if (o.transport.kind === 'stdio') {
    assert.deepEqual(o.transport.env, { TOKEN: 'secret' })
  } else {
    assert.fail('expected stdio')
  }
})

test('parseCodexToml parses url-based MCP entry', () => {
  const out = parseCodexToml(`
[mcp_servers.api]
url = "https://example.com/mcp"
bearer_token = "tok"
`)
  const o = out[0]!
  assert.equal(o.name, 'api')
  if (o.transport.kind === 'http') {
    assert.equal(o.transport.url, 'https://example.com/mcp')
    assert.equal(o.transport.bearerToken, 'tok')
  } else {
    assert.fail('expected http')
  }
})

// ---------------------------------------------------------------------------
// parseClaudeDesktopJson edge cases
// ---------------------------------------------------------------------------

test('parseClaudeDesktopJson parses url-based entry', () => {
  const raw = JSON.stringify({
    mcpServers: {
      remote: { url: 'https://mcp.example.com' },
    },
  })
  const out = parseClaudeDesktopJson(raw, 'claude-desktop')
  assert.equal(out.length, 1)
  if (out[0]!.transport.kind === 'http') {
    assert.equal(out[0]!.transport.url, 'https://mcp.example.com')
  } else {
    assert.fail('expected http')
  }
})

test('parseClaudeDesktopJson filters non-string args', () => {
  const raw = JSON.stringify({
    mcpServers: {
      fs: { command: 'npx', args: ['-y', 42, null, 'real'] },
    },
  })
  const out = parseClaudeDesktopJson(raw, 'claude-desktop')
  const o = out[0]!
  if (o.transport.kind === 'stdio') {
    assert.deepEqual(o.transport.args, ['-y', 'real'])
  } else {
    assert.fail('expected stdio')
  }
})

// ---------------------------------------------------------------------------
// manualConfig edge cases
// ---------------------------------------------------------------------------

test('manualConfig slug from invalid URL falls back to mcp-remote', () => {
  const c = manualConfig({ url: 'not-a-url' })
  assert.equal(c.name, 'mcp-remote')
})

test('manualConfig slug from command with slashes uses last segment', () => {
  const c = manualConfig({ command: 'npx -y @scope/pkg/name' })
  assert.match(c.name, /name/)
})

// ---------------------------------------------------------------------------
// emitter edge cases
// ---------------------------------------------------------------------------

test('emitServerProject http transport throws', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'glyph-emit-http-'))
  try {
    const config = {
      name: 'http-test',
      source: 'manual' as const,
      transport: { kind: 'http' as const, url: 'https://example.com' },
    }
    await assert.rejects(
      () => emitServerProject(config, [fakeGlyph('echo', 'safe')], 3100, tmp),
      /only supports stdio transports/,
    )
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})

test('emitServerProject no env keys writes placeholder .env.example', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'glyph-noenv-'))
  try {
    const config = {
      name: 'noenv-test',
      source: 'manual' as const,
      transport: { kind: 'stdio' as const, command: 'echo' },
    }
    await emitServerProject(config, [fakeGlyph('echo', 'safe')], 3100, tmp)
    const env = await readFile(join(tmp, '.env.example'), 'utf8')
    assert.match(env, /No environment variables were declared/)
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})

test('emitTopLevelIndex writes a multi-server README', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'glyph-topindex-'))
  try {
    await emitTopLevelIndex(tmp, [
      {
        config: {
          name: 'fs',
          source: 'codex',
          transport: { kind: 'stdio', command: 'npx' },
        },
        port: 3100,
        toolCount: 2,
        cards: [],
        outputDir: 'out/fs',
      },
      {
        config: {
          name: 'api',
          source: 'claude-desktop',
          transport: { kind: 'http', url: 'https://example.com' },
        },
        port: 3101,
        toolCount: 3,
        cards: [],
        outputDir: 'out/api',
      },
    ])
    const readme = await readFile(join(tmp, 'README.md'), 'utf8')
    assert.match(readme, /Glyph imports/)
    assert.match(readme, /fs.*codex.*3100.*2/)
    assert.match(readme, /api.*claude-desktop.*3101.*3/)
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// report edge cases
// ---------------------------------------------------------------------------

test('emitReport no imported no skipped produces empty sections', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'glyph-report-empty-'))
  try {
    const path = await emitReport(tmp, { imported: [], skipped: [] })
    const md = await readFile(path, 'utf8')
    assert.match(md, /Imported \(0\)/)
    assert.match(md, /\(none\)/)
    assert.match(md, /Skipped \(0\)/)
    assert.match(md, /All imported cards are tagged.*safe/)
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// adapter stubs (hermes-agent, openclaw)
// ---------------------------------------------------------------------------

test('hermesAgentAdapter detect returns false', async () => {
  assert.equal(await hermesAgentAdapter.detect(), false)
})

test('hermesAgentAdapter load throws not-implemented', async () => {
  await assert.rejects(() => hermesAgentAdapter.load(), /not implemented yet/)
})

test('openclawAdapter detect returns false', async () => {
  assert.equal(await openclawAdapter.detect(), false)
})

test('openclawAdapter load throws not-implemented', async () => {
  await assert.rejects(() => openclawAdapter.load(), /not implemented yet/)
})

// ---------------------------------------------------------------------------
// runImportMcp index edge cases
// ---------------------------------------------------------------------------

test('runImportMcp rejects unknown client id', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'glyph-unknown-client-'))
  try {
    await assert.rejects(
      () =>
        runImportMcp({
          from: 'not-a-client' as any,
          options: { output: tmp, portBase: 3100, dryRun: true, timeoutMs: 1_000 },
        }),
      /unknown client/,
    )
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})

// Path relative to cwd so the spawned `node <script>` command has no spaces —
// manualConfig splits the command string on whitespace, and the repo may live
// under a path that contains spaces.
const STUB_SERVER = relative(
  process.cwd(),
  fileURLToPath(new URL('./fixtures/stub-mcp-server.mjs', import.meta.url)),
)

test('runImportMcp imports a live stdio server end-to-end', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'glyph-import-live-'))
  try {
    const result = await runImportMcp({
      manual: { command: `node ${STUB_SERVER}`, name: 'stub' },
      options: { output: tmp, portBase: 3100, dryRun: false, timeoutMs: 15_000 },
    })
    assert.equal(result.skipped.length, 0, `unexpected skips: ${JSON.stringify(result.skipped)}`)
    assert.equal(result.imported.length, 1)
    const server = result.imported[0]!
    assert.equal(server.toolCount, 2)
    assert.ok(result.reportPath)

    // safeDirName turned the manual name into a directory and the project was emitted.
    const serverTs = await readFile(join(server.outputDir, 'server.ts'), 'utf8')
    assert.match(serverTs, /StdioClientTransport/)
    // delete_file (normalized to delete-file) must be flagged danger by the
    // adapter's dangerous-word heuristic.
    const readme = await readFile(join(server.outputDir, 'README.md'), 'utf8')
    assert.match(readme, /delete-file.*danger/)

    // A single imported server still writes the top-level index.
    const topIndex = await readFile(join(tmp, 'README.md'), 'utf8')
    assert.match(topIndex, /Glyph imports/)
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})

test('runImportMcp --dry-run with --url prints the http transport plan', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'glyph-dryrun-url-'))
  try {
    const result = await runImportMcp({
      manual: { url: 'https://mcp.example.com/sse' },
      options: { output: tmp, portBase: 3100, dryRun: true, timeoutMs: 1_000 },
    })
    assert.equal(result.imported.length, 0)
    assert.equal(result.skipped.length, 0)
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})

/**
 * Enter `dir` as BOTH the working directory and the home directory, and return
 * a restore function.
 *
 * chdir alone is not enough: the client adapters also read a *global* config
 * under `homedir()`. Without isolating home, these tests read the developer's
 * real ~/.cursor/mcp.json (or ~/.codex/config.toml) and merge those servers
 * into the result — so they pass on a clean CI runner and fail on any machine
 * that actually uses Cursor or Codex.
 */
function enterIsolatedHome(dir: string): () => void {
  const prevCwd = process.cwd()
  const prevHome = process.env.HOME
  const prevUserProfile = process.env.USERPROFILE
  process.chdir(dir)
  process.env.HOME = dir
  process.env.USERPROFILE = dir
  return () => {
    process.chdir(prevCwd)
    if (prevHome === undefined) delete process.env.HOME
    else process.env.HOME = prevHome
    if (prevUserProfile === undefined) delete process.env.USERPROFILE
    else process.env.USERPROFILE = prevUserProfile
  }
}

test('runImportMcp --from with an empty client config throws no-servers', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'glyph-empty-from-'))
  let restore = () => {}
  try {
    await mkdir(join(tmp, '.cursor'), { recursive: true })
    await writeFile(join(tmp, '.cursor', 'mcp.json'), JSON.stringify({ mcpServers: {} }))
    restore = enterIsolatedHome(tmp)
    await assert.rejects(
      () =>
        runImportMcp({
          from: 'cursor',
          options: { output: join(tmp, 'out'), portBase: 3100, dryRun: true, timeoutMs: 1_000 },
        }),
      /no MCP servers declared/,
    )
  } finally {
    restore()
    await rm(tmp, { recursive: true, force: true })
  }
})

test('cursorAdapter detect + load read .cursor/mcp.json from the project cwd', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'glyph-cursor-'))
  let restore = () => {}
  try {
    await mkdir(join(tmp, '.cursor'), { recursive: true })
    await writeFile(
      join(tmp, '.cursor', 'mcp.json'),
      JSON.stringify({ mcpServers: { fs: { command: 'npx', args: ['-y', 'server-fs'] } } }),
    )
    restore = enterIsolatedHome(tmp)
    assert.equal(await cursorAdapter.detect(), true)
    const configs = await cursorAdapter.load()
    assert.equal(configs.length, 1)
    assert.equal(configs[0]?.name, 'fs')
    assert.equal(configs[0]?.source, 'cursor')
  } finally {
    restore()
    await rm(tmp, { recursive: true, force: true })
  }
})
