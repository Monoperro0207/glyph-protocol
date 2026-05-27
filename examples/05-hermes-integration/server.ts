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
import { readFileSync } from 'node:fs'
import { readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { defineGlyph, GlyphServer } from '@glyphp/server'
import Database from 'better-sqlite3'
import { z } from 'zod'
import { createJail } from './jail.js'

const WORKSPACE_ROOT = resolve(
  process.env.WORKSPACE_ROOT ?? resolve(import.meta.dirname ?? '.', 'workspace'),
)
const HTTP_WHITELIST = new Set((process.env.HTTP_WHITELIST ?? 'example.org,example.com').split(','))

const { jailedReadPath, jailedWritePath } = createJail({ root: WORKSPACE_ROOT })

const server = new GlyphServer({
  port: Number(process.env.PORT ?? 3199),
})

// ── filesystem ─────────────────────────────────────────────────────────────
server.register(
  defineGlyph({
    name: 'fs.read',
    intent: 'Read a UTF-8 text file from the agent workspace. Returns its contents.',
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
      const abs = await jailedReadPath(path)
      const content = await readFile(abs, 'utf8')
      return { path, bytes: content.length, content }
    },
  }),
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
      entries: z.array(z.object({ name: z.string(), isDir: z.boolean(), bytes: z.number() })),
    }),
    provider: 'hermes-test.fs',
    handler: async ({ path }) => {
      const abs = await jailedReadPath(path)
      const names = await readdir(abs)
      const entries = await Promise.all(
        names.map(async (name) => {
          const s = await stat(resolve(abs, name))
          return { name, isDir: s.isDirectory(), bytes: s.size }
        }),
      )
      return { path, entries }
    },
  }),
)

server.register(
  defineGlyph({
    name: 'fs.write',
    intent: 'Write a UTF-8 text file to the agent workspace. Overwrites if exists.',
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
      const abs = await jailedWritePath(path)
      await writeFile(abs, content, 'utf8')
      return { path, bytes: content.length }
    },
  }),
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
          `host not in whitelist: ${host} (allowed: ${[...HTTP_WHITELIST].join(', ')})`,
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
  }),
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
      rows: z.array(z.record(z.string(), z.unknown())),
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
  }),
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
  }),
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
  }),
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
  }),
)

// ── Inflated tool surface (~50 total) ──────────────────────────────────────
// To exercise the cost of large tool listings (and the lazy-bridge ahorro),
// register many small "realistic-looking" tools. Each has a distinct intent
// and schema — the model could plausibly call any of them on a landing-page
// task (string manipulation, encoding, color/CSS helpers, html scaffolding).

const safe = {
  latency: 'fast' as const,
  sideEffects: false,
  reversible: true,
  riskTier: 'safe' as const,
  requiresConfirmation: false,
}

const smallTools: Array<{
  name: string
  intent: string
  input: z.ZodTypeAny
  output: z.ZodTypeAny
  handler: (args: any) => any
}> = [
  // text / string
  {
    name: 'text.upper',
    intent: 'Uppercase a string.',
    input: z.object({ text: z.string() }),
    output: z.object({ text: z.string() }),
    handler: ({ text }) => ({ text: text.toUpperCase() }),
  },
  {
    name: 'text.lower',
    intent: 'Lowercase a string.',
    input: z.object({ text: z.string() }),
    output: z.object({ text: z.string() }),
    handler: ({ text }) => ({ text: text.toLowerCase() }),
  },
  {
    name: 'text.trim',
    intent: 'Trim whitespace from a string.',
    input: z.object({ text: z.string() }),
    output: z.object({ text: z.string() }),
    handler: ({ text }) => ({ text: text.trim() }),
  },
  {
    name: 'text.reverse',
    intent: 'Reverse a string character by character.',
    input: z.object({ text: z.string() }),
    output: z.object({ text: z.string() }),
    handler: ({ text }) => ({ text: [...text].reverse().join('') }),
  },
  {
    name: 'text.length',
    intent: 'Get the character length of a string.',
    input: z.object({ text: z.string() }),
    output: z.object({ length: z.number() }),
    handler: ({ text }) => ({ length: text.length }),
  },
  {
    name: 'text.split',
    intent: 'Split a string by a separator.',
    input: z.object({ text: z.string(), sep: z.string() }),
    output: z.object({ parts: z.array(z.string()) }),
    handler: ({ text, sep }) => ({ parts: text.split(sep) }),
  },
  {
    name: 'text.join',
    intent: 'Join an array of strings with a separator.',
    input: z.object({ parts: z.array(z.string()), sep: z.string() }),
    output: z.object({ text: z.string() }),
    handler: ({ parts, sep }) => ({ text: parts.join(sep) }),
  },
  {
    name: 'text.replace',
    intent: 'Replace all occurrences of a substring.',
    input: z.object({ text: z.string(), search: z.string(), replacement: z.string() }),
    output: z.object({ text: z.string() }),
    handler: ({ text, search, replacement }) => ({ text: text.split(search).join(replacement) }),
  },
  {
    name: 'text.slugify',
    intent: 'Convert a string to a URL-safe slug (lowercase, hyphens, ascii).',
    input: z.object({ text: z.string() }),
    output: z.object({ slug: z.string() }),
    handler: ({ text }) => ({
      slug: text
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, ''),
    }),
  },
  {
    name: 'text.titlecase',
    intent: 'Convert a string to Title Case.',
    input: z.object({ text: z.string() }),
    output: z.object({ text: z.string() }),
    handler: ({ text }) => ({ text: text.replace(/\b\w/g, (c: string) => c.toUpperCase()) }),
  },
  // encoding
  {
    name: 'encode.base64',
    intent: 'Base64-encode a UTF-8 string.',
    input: z.object({ text: z.string() }),
    output: z.object({ b64: z.string() }),
    handler: ({ text }) => ({ b64: Buffer.from(text, 'utf8').toString('base64') }),
  },
  {
    name: 'decode.base64',
    intent: 'Decode a base64 string to UTF-8.',
    input: z.object({ b64: z.string() }),
    output: z.object({ text: z.string() }),
    handler: ({ b64 }) => ({ text: Buffer.from(b64, 'base64').toString('utf8') }),
  },
  {
    name: 'encode.uri',
    intent: 'URI-encode a string for safe use in URLs.',
    input: z.object({ text: z.string() }),
    output: z.object({ encoded: z.string() }),
    handler: ({ text }) => ({ encoded: encodeURIComponent(text) }),
  },
  {
    name: 'decode.uri',
    intent: 'URI-decode a string.',
    input: z.object({ text: z.string() }),
    output: z.object({ decoded: z.string() }),
    handler: ({ text }) => ({ decoded: decodeURIComponent(text) }),
  },
  {
    name: 'encode.json',
    intent: 'JSON-stringify an arbitrary value.',
    input: z.object({ value: z.unknown() }),
    output: z.object({ json: z.string() }),
    handler: ({ value }) => ({ json: JSON.stringify(value) }),
  },
  {
    name: 'decode.json',
    intent: 'Parse a JSON string into a value.',
    input: z.object({ json: z.string() }),
    output: z.object({ value: z.unknown() }),
    handler: ({ json }) => ({ value: JSON.parse(json) }),
  },
  // math
  {
    name: 'math.add',
    intent: 'Add two numbers.',
    input: z.object({ a: z.number(), b: z.number() }),
    output: z.object({ result: z.number() }),
    handler: ({ a, b }) => ({ result: a + b }),
  },
  {
    name: 'math.sub',
    intent: 'Subtract b from a.',
    input: z.object({ a: z.number(), b: z.number() }),
    output: z.object({ result: z.number() }),
    handler: ({ a, b }) => ({ result: a - b }),
  },
  {
    name: 'math.mul',
    intent: 'Multiply two numbers.',
    input: z.object({ a: z.number(), b: z.number() }),
    output: z.object({ result: z.number() }),
    handler: ({ a, b }) => ({ result: a * b }),
  },
  {
    name: 'math.div',
    intent: 'Divide a by b.',
    input: z.object({ a: z.number(), b: z.number() }),
    output: z.object({ result: z.number() }),
    handler: ({ a, b }) => ({ result: a / b }),
  },
  {
    name: 'math.pow',
    intent: 'Raise a to the power of b.',
    input: z.object({ a: z.number(), b: z.number() }),
    output: z.object({ result: z.number() }),
    handler: ({ a, b }) => ({ result: a ** b }),
  },
  {
    name: 'math.sqrt',
    intent: 'Square root of n.',
    input: z.object({ n: z.number() }),
    output: z.object({ result: z.number() }),
    handler: ({ n }) => ({ result: Math.sqrt(n) }),
  },
  {
    name: 'math.min',
    intent: 'Minimum of a list of numbers.',
    input: z.object({ numbers: z.array(z.number()) }),
    output: z.object({ result: z.number() }),
    handler: ({ numbers }) => ({ result: Math.min(...numbers) }),
  },
  {
    name: 'math.max',
    intent: 'Maximum of a list of numbers.',
    input: z.object({ numbers: z.array(z.number()) }),
    output: z.object({ result: z.number() }),
    handler: ({ numbers }) => ({ result: Math.max(...numbers) }),
  },
  {
    name: 'math.avg',
    intent: 'Arithmetic mean of a list of numbers.',
    input: z.object({ numbers: z.array(z.number()) }),
    output: z.object({ result: z.number() }),
    handler: ({ numbers }) => ({
      result: numbers.reduce((a: number, b: number) => a + b, 0) / numbers.length,
    }),
  },
  // color / css
  {
    name: 'color.hexToRgb',
    intent: 'Convert a #RRGGBB hex color to an {r,g,b} object.',
    input: z.object({ hex: z.string() }),
    output: z.object({ r: z.number(), g: z.number(), b: z.number() }),
    handler: ({ hex }) => {
      const h = hex.replace('#', '')
      return {
        r: parseInt(h.slice(0, 2), 16),
        g: parseInt(h.slice(2, 4), 16),
        b: parseInt(h.slice(4, 6), 16),
      }
    },
  },
  {
    name: 'color.rgbToHex',
    intent: 'Convert {r,g,b} to #RRGGBB hex.',
    input: z.object({ r: z.number(), g: z.number(), b: z.number() }),
    output: z.object({ hex: z.string() }),
    handler: ({ r, g, b }) => ({
      hex: `#${[r, g, b].map((v: number) => v.toString(16).padStart(2, '0')).join('')}`,
    }),
  },
  {
    name: 'color.lighten',
    intent: 'Lighten a hex color by a 0-1 amount.',
    input: z.object({ hex: z.string(), amount: z.number() }),
    output: z.object({ hex: z.string() }),
    handler: ({ hex, amount }) => {
      const h = hex.replace('#', '')
      const mix = (v: number) => Math.min(255, Math.round(v + (255 - v) * amount))
      return {
        hex:
          '#' +
          [0, 2, 4]
            .map((i) =>
              mix(parseInt(h.slice(i, i + 2), 16))
                .toString(16)
                .padStart(2, '0'),
            )
            .join(''),
      }
    },
  },
  {
    name: 'css.minify',
    intent: 'Strip comments and collapse whitespace in CSS.',
    input: z.object({ css: z.string() }),
    output: z.object({ css: z.string() }),
    handler: ({ css }) => ({
      css: css
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\s+/g, ' ')
        .trim(),
    }),
  },
  {
    name: 'html.escape',
    intent: 'Escape HTML special characters in a string.',
    input: z.object({ text: z.string() }),
    output: z.object({ text: z.string() }),
    handler: ({ text }) => ({
      text: text.replace(
        /[&<>"']/g,
        (c: string) =>
          ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
      ),
    }),
  },
  {
    name: 'html.unescape',
    intent: 'Unescape HTML entities in a string.',
    input: z.object({ text: z.string() }),
    output: z.object({ text: z.string() }),
    handler: ({ text }) => ({
      text: text.replace(
        /&(amp|lt|gt|quot|#39);/g,
        (_: string, e: string) =>
          ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" })[e] as string,
      ),
    }),
  },
  // time
  {
    name: 'time.now',
    intent: 'Current UNIX epoch in milliseconds.',
    input: z.object({}),
    output: z.object({ ms: z.number() }),
    handler: () => ({ ms: Date.now() }),
  },
  {
    name: 'time.iso',
    intent: 'Current time as ISO-8601.',
    input: z.object({}),
    output: z.object({ iso: z.string() }),
    handler: () => ({ iso: new Date().toISOString() }),
  },
  {
    name: 'time.format',
    intent: 'Format an epoch-ms timestamp as ISO-8601.',
    input: z.object({ ms: z.number() }),
    output: z.object({ iso: z.string() }),
    handler: ({ ms }) => ({ iso: new Date(ms).toISOString() }),
  },
  // util
  {
    name: 'util.uuidv7',
    intent: 'Generate a time-ordered UUIDv7-like id (random fallback).',
    input: z.object({}),
    output: z.object({ id: z.string() }),
    handler: () => ({ id: randomUUID() }),
  },
  {
    name: 'util.random',
    intent: 'Random float in [0,1).',
    input: z.object({}),
    output: z.object({ value: z.number() }),
    handler: () => ({ value: Math.random() }),
  },
  {
    name: 'util.randint',
    intent: 'Random integer in [min,max].',
    input: z.object({ min: z.number(), max: z.number() }),
    output: z.object({ value: z.number() }),
    handler: ({ min, max }) => ({ value: Math.floor(min + Math.random() * (max - min + 1)) }),
  },
  {
    name: 'util.echo',
    intent: 'Return the input value unchanged (debug helper).',
    input: z.object({ value: z.unknown() }),
    output: z.object({ value: z.unknown() }),
    handler: ({ value }) => ({ value }),
  },
  // hashing variants
  {
    name: 'hash.md5',
    intent: 'MD5 hex digest of input text (legacy, not for security).',
    input: z.object({ text: z.string() }),
    output: z.object({ hex: z.string() }),
    handler: ({ text }) => ({ hex: createHash('md5').update(text).digest('hex') }),
  },
  {
    name: 'hash.sha1',
    intent: 'SHA-1 hex digest of input text.',
    input: z.object({ text: z.string() }),
    output: z.object({ hex: z.string() }),
    handler: ({ text }) => ({ hex: createHash('sha1').update(text).digest('hex') }),
  },
  {
    name: 'hash.sha512',
    intent: 'SHA-512 hex digest of input text.',
    input: z.object({ text: z.string() }),
    output: z.object({ hex: z.string() }),
    handler: ({ text }) => ({ hex: createHash('sha512').update(text).digest('hex') }),
  },
]

for (const t of smallTools) {
  server.register(
    defineGlyph({
      name: t.name,
      intent: t.intent,
      cost: safe,
      input: t.input,
      output: t.output,
      provider: 'hermes-test.bulk',
      handler: t.handler,
    }),
  )
}

await server.start()
const totalGlyphs = 8 + smallTools.length
console.log(
  `[hermes-glyph-server] ${totalGlyphs} glyphs registered, listening on http://127.0.0.1:${process.env.PORT ?? 3199}`,
)
