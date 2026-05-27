#!/usr/bin/env node
/**
 * External type smoke test.
 *
 * Builds and packs the public `@glyphp/*` packages, installs the resulting
 * tarballs into a throwaway TypeScript project outside the monorepo, and
 * typechecks consumer code against the published (`dist`) declarations.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

function run(cmd, args, cwd) {
  try {
    return execFileSync(cmd, args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
  } catch (err) {
    if (err.stdout) process.stdout.write(err.stdout)
    if (err.stderr) process.stderr.write(err.stderr)
    throw err
  }
}

const PKG_DIRS = [
  'packages/types',
  'packages/core',
  'packages/server',
  'packages/client',
  'packages/resolver',
  'packages/conformance',
  'packages/cli',
  'packages/adapters/openapi',
  'packages/adapters/mcp',
  'packages/adapters/mcp-server',
  'packages/exporter-otel',
  'packages/integrations/vercel-ai',
  'packages/integrations/openai-agents',
  'packages/integrations/langchain',
  'packages/integrations/llamaindex',
]

const CONSUMER_TS = `import type { GlyphCard, JSONSchema } from '@glyphp/types'
import {
  FileKeyRegistry,
  StaticKeyRegistry,
  buildKeyRegistry,
  computeGlyphId,
  compileJsonSchema,
  generateKeyPair,
  verifyReceipt,
  type GlyphSigner,
} from '@glyphp/core'
import { GlyphClient } from '@glyphp/client'
import { GlyphServer, defineGlyph } from '@glyphp/server'
import { glyphsFromMcpTools } from '@glyphp/adapter-mcp'
import { mcpServerFromGlyph } from '@glyphp/adapter-mcp-server'
import { glyphsFromOpenApi } from '@glyphp/adapter-openapi'
import { GlyphResolver } from '@glyphp/resolver'
import { z } from 'zod'

const input = z.object({ name: z.string() })
const output = z.object({ message: z.string() })
const glyph = defineGlyph({
  name: 'hello',
  intent: 'Greets a user',
  cost: { latency: 'fast', sideEffects: false, reversible: true, riskTier: 'safe', requiresConfirmation: false },
  input,
  output,
  provider: 'consumer-smoke',
  handler: async ({ name }) => ({ message: 'Hello ' + name }),
})

const card: GlyphCard = glyph.card
const schema: JSONSchema = card.input
const id: string = computeGlyphId(card)
const server = new GlyphServer({ port: 0 })
server.register(glyph)
const client = new GlyphClient({ baseUrl: 'http://localhost:1234' })
const kp = generateKeyPair()
const registryDoc = buildKeyRegistry({ serverId: 'consumer.test', entries: [], activePrivateKey: kp.privateKey })
const registry = new StaticKeyRegistry(registryDoc)
const fileRegistry = new FileKeyRegistry('./keys.json')
const signer: GlyphSigner | undefined = undefined
const validator = compileJsonSchema({ type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] })
const mcpGlyphs = glyphsFromMcpTools([{ name: 'tool', inputSchema: { type: 'object' } }], async () => ({ ok: true }))
const mcpServer = mcpServerFromGlyph(client)
const openApiGlyphs = glyphsFromOpenApi({ openapi: '3.0.0', info: { title: 'T', version: '1' }, paths: {} }, { baseUrl: 'https://example.test' })
const resolver = new GlyphResolver([])

void schema
void id
void registry
void fileRegistry
void signer
void validator
void mcpGlyphs
void mcpServer
void openApiGlyphs
void resolver
verifyReceipt
`

console.log('[type-smoke] building all packages…')
run('pnpm', ['-r', 'build'], repoRoot)

const work = mkdtempSync(join(tmpdir(), 'glyph-type-smoke-'))
const tarDir = join(work, 'tarballs')
const proj = join(work, 'project')
mkdirSync(tarDir, { recursive: true })
mkdirSync(proj, { recursive: true })

try {
  const deps = {}
  const overrides = {}
  for (const dir of PKG_DIRS) {
    const pkgPath = join(repoRoot, dir)
    const { name, version } = JSON.parse(readFileSync(join(pkgPath, 'package.json'), 'utf8'))
    run('pnpm', ['pack', '--pack-destination', tarDir], pkgPath)
    const tarball = `file:${join(tarDir, `${name.replace('@', '').replace('/', '-')}-${version}.tgz`)}`
    deps[name] = tarball
    overrides[name] = tarball
    console.log(`[type-smoke] packed ${name}@${version}`)
  }
  deps.zod = JSON.parse(
    readFileSync(join(repoRoot, 'packages/server/package.json'), 'utf8'),
  ).dependencies.zod
  deps.typescript = JSON.parse(
    readFileSync(join(repoRoot, 'package.json'), 'utf8'),
  ).devDependencies.typescript
  deps['@types/node'] = JSON.parse(
    readFileSync(join(repoRoot, 'package.json'), 'utf8'),
  ).devDependencies['@types/node']

  writeFileSync(
    join(proj, 'package.json'),
    `${JSON.stringify(
      {
        name: 'glyph-type-smoke',
        private: true,
        type: 'module',
        dependencies: deps,
        overrides,
      },
      null,
      2,
    )}\n`,
  )
  writeFileSync(
    join(proj, 'tsconfig.json'),
    `${JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          strict: true,
          skipLibCheck: false,
          noEmit: true,
        },
        include: ['consumer.ts'],
      },
      null,
      2,
    )}\n`,
  )
  writeFileSync(join(proj, 'consumer.ts'), CONSUMER_TS)

  console.log('[type-smoke] installing tarballs into an external project…')
  run('npm', ['install', '--install-strategy', 'nested', '--legacy-peer-deps'], proj)

  console.log('[type-smoke] typechecking against published declarations…')
  run('npx', ['tsc', '-p', 'tsconfig.json'], proj)

  console.log('[type-smoke] PASS')
} finally {
  rmSync(work, { recursive: true, force: true })
}
