/**
 * Example Glyph server for the Hermes/DeepSeek integration test.
 *
 * Registers six tools spanning four families: filesystem (jailed to
 * /workspace), HTTP fetch (whitelist), SQL (in-memory SQLite), and math/util.
 * Wide enough for a realistic agentic task; varied enough to exercise risk
 * tiers, schemas, and Glyph's inert-data sanitization.
 *
 * Run: `tsx server.ts` (or `pnpm start` from this dir).
 */
import { createHash, randomUUID } from 'node:crypto'
import { readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { readFileSync } from 'node:fs'
import Database from 'better-sqlite3'
import { z } from 'zod'
import { defineGlyph, GlyphServer } from '@glyphp/server'

const WORKSPACE_ROOT = resolve(
  process.env.WORKSPACE_ROOT ?? resolve(import.meta.dirname ?? '.', 'workspace')
)
const HTTP_WHITELIST = new Set(
  (process.env.HTTP_WHITELIST ?? 'example.org,example.com').split(',')
)

/** Refuses any path outside WORKSPACE_ROOT — basic jailing. */
function jailedPath(input: string): string {
  const abs = resolve(WORKSPACE_ROOT, input)
  if (!abs.startsWith(WORKSPACE_ROOT + sep) && abs !== WORKSPACE_ROOT) {
    throw new Error(`path escapes workspace: ${input}`)
  }
  return abs
}

const server = new GlyphServer({
  port: Number(process.env.PORT ?? 3199),
})

// ── filesystem ─────────────────────────────────────────────────────────────
server.register(
  defineGlyph({
    name: 'fs.read',
    intent:
      'Read a UTF-8 text file from the agent workspace. Returns its contents.',
    cost: {
      latency: 'fast',
      sideEffects: false,
      reversible: true,
      riskTier: 'safe',
      requiresConfirmation: false,
    },
    input: z.object({ path: z.string() }),
    output: z.object({
      path: z.string(),
      bytes: z.number(),
      content: z.string(),
    }),
    provider: 'hermes-test.fs',
    handler: async ({ path }) => {
      const abs = jailedPath(path)
      const content = await readFile(abs, 'utf8')
      return { path, bytes: content.length, content }
    },
  })
)

server.register(
  defineGlyph({
    name: 'fs.list',
    intent: 'List the files (recursive) under a directory in the workspace.',
    cost: {
      latency: 'fast',
      sideEffects: false,
      reversible: true,
      riskTier: 'safe',
      requiresConfirmation: false,
    },
    input: z.object({ path: z.string() }),
    output: z.object({
      path: z.string(),
      entries: z.array(
        z.object({ name: z.string(), isDir: z.boolean(), bytes: z.number() })
      ),
    }),
    provider: 'hermes-test.fs',
    handler: async ({ path }) => {
      const abs = jailedPath(path)
      const names = await readdir(abs)
      const entries = await Promise.all(
        names.map(async (name) => {
          const s = await stat(resolve(abs, name))
          return { name, isDir: s.isDirectory(), bytes: s.size }
        })
      )
      return { path, entries }
    },
  })
)

server.register(
  defineGlyph({
    name: 'fs.write',
    intent:
      'Write a UTF-8 text file to the agent workspace. Overwrites if exists.',
    cost: {
      latency: 'fast',
      sideEffects: true,
      reversible: false,
      riskTier: 'caution',
      // Confirmation gate is intentionally OFF here so the MCP bridge can
      // exercise writes. Native Glyph clients would normally flip this on
      // for any destructive operation. The native-test/test.py demonstrates
      // the confirmation flow with a separate `fs.delete` glyph that does
      // require confirmation.
      requiresConfirmation: false,
    },
    input: z.object({ path: z.string(), content: z.string() }),
    output: z.object({ path: z.string(), bytes: z.number() }),
    provider: 'hermes-test.fs',
    handler: async ({ path, content }) => {
      const abs = jailedPath(path)
      await writeFile(abs, content, 'utf8')
      return { path, bytes: content.length }
    },
  })
)

// ── http ───────────────────────────────────────────────────────────────────
server.register(
  defineGlyph({
    name: 'http.fetch',
    intent:
      'Fetch the body of a URL. Restricted to a whitelist of hosts. Output is sanitized: invisible-unicode and bidi-override characters are stripped before delivery.',
    cost: {
      latency: 'medium',
      sideEffects: false,
      reversible: true,
      riskTier: 'caution',
      requiresConfirmation: false,
    },
    input: z.object({ url: z.string().url() }),
    output: z.object({
      url: z.string(),
      status: z.number(),
      contentType: z.string().optional(),
      body: z.string(),
    }),
    provider: 'hermes-test.http',
    handler: async ({ url }) => {
      const host = new URL(url).hostname
      if (!HTTP_WHITELIST.has(host)) {
        throw new Error(
          `host not in whitelist: ${host} (allowed: ${[...HTTP_WHITELIST].join(', ')})`
        )
      }
      const res = await fetch(url)
      const body = await res.text()
      return {
        url,
        status: res.status,
        contentType: res.headers.get('content-type') ?? undefined,
        body,
      }
    },
  })
)

// ── SQL ────────────────────────────────────────────────────────────────────
const db = new Database(':memory:')
const seedPath = resolve(import.meta.dirname ?? '.', 'seed.sql')
db.exec(readFileSync(seedPath, 'utf8'))

server.register(
  defineGlyph({
    name: 'sql.query',
    intent:
      'Run a read-only SQL query against the in-memory database. SELECT only — DDL/DML rejected.',
    cost: {
      latency: 'fast',
      sideEffects: false,
      reversible: true,
      riskTier: 'caution',
      requiresConfirmation: false,
    },
    input: z.object({ sql: z.string() }),
    output: z.object({
      columns: z.array(z.string()),
      rows: z.array(z.record(z.unknown())),
    }),
    provider: 'hermes-test.sql',
    handler: async ({ sql }) => {
      const trimmed = sql.trim().toLowerCase()
      if (!trimmed.startsWith('select')) {
        throw new Error('only SELECT statements are allowed')
      }
      const stmt = db.prepare(sql)
      const rows = stmt.all() as Array<Record<string, unknown>>
      const columns = stmt.columns().map((c) => c.name)
      return { columns, rows }
    },
  })
)

// ── math / utility ─────────────────────────────────────────────────────────
server.register(
  defineGlyph({
    name: 'math.sum',
    intent: 'Sum a list of numbers.',
    cost: {
      latency: 'fast',
      sideEffects: false,
      reversible: true,
      riskTier: 'safe',
      requiresConfirmation: false,
    },
    input: z.object({ numbers: z.array(z.number()) }),
    output: z.object({ sum: z.number() }),
    provider: 'hermes-test.math',
    handler: async ({ numbers }) => ({
      sum: numbers.reduce((a, b) => a + b, 0),
    }),
  })
)

server.register(
  defineGlyph({
    name: 'math.hash',
    intent: 'Compute a SHA-256 hex digest of the input text.',
    cost: {
      latency: 'fast',
      sideEffects: false,
      reversible: true,
      riskTier: 'safe',
      requiresConfirmation: false,
    },
    input: z.object({ text: z.string() }),
    output: z.object({ algo: z.string(), hex: z.string() }),
    provider: 'hermes-test.math',
    handler: async ({ text }) => ({
      algo: 'sha256',
      hex: createHash('sha256').update(text).digest('hex'),
    }),
  })
)

server.register(
  defineGlyph({
    name: 'util.uuid',
    intent: 'Generate a random UUIDv4.',
    cost: {
      latency: 'fast',
      sideEffects: false,
      reversible: true,
      riskTier: 'safe',
      requiresConfirmation: false,
    },
    input: z.object({}),
    output: z.object({ uuid: z.string() }),
    provider: 'hermes-test.util',
    handler: async () => ({ uuid: randomUUID() }),
  })
)

await server.start()
console.log(
  `[hermes-glyph-server] 8 glyphs registered, listening on http://127.0.0.1:${process.env.PORT ?? 3199}`
)
