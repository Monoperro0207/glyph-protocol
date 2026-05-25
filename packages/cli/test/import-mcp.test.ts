import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type { GlyphDefinition } from '@glyphp/server'
import type { GlyphCard } from '@glyphp/types'
import { parseClaudeDesktopJson } from '../src/commands/import-mcp/clients/claude-desktop.js'
import { parseCodexToml } from '../src/commands/import-mcp/clients/codex.js'
import { emitServerProject } from '../src/commands/import-mcp/emitter.js'
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
