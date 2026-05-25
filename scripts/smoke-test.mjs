#!/usr/bin/env node
/**
 * External smoke test.
 *
 * Builds and packs every `@glyphp/*` package, installs the resulting tarballs
 * into a throwaway project *outside* the monorepo, and runs a real
 * server <-> client round-trip against the published (`dist`) entrypoints.
 *
 * This catches packaging regressions the in-repo tests cannot see: a bad
 * `publishConfig`, a missing `dist` file, or an export map that only works
 * because tests run from `src`.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Runs a command, returning trimmed stdout; surfaces all output on failure. */
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

// Every publishable package, in dependency order.
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
]

const SMOKE_APP = `import { GlyphServer, defineGlyph } from '@glyphp/server'
import { GlyphClient } from '@glyphp/client'
import { verifyReceipt } from '@glyphp/core'
import { z } from 'zod'

const greet = defineGlyph({
  name: 'greet',
  intent: 'Greets a name',
  cost: { latency: 'fast', sideEffects: false, reversible: true, riskTier: 'safe', requiresConfirmation: false },
  input: z.object({ name: z.string() }),
  output: z.object({ message: z.string() }),
  provider: 'smoke',
  handler: async ({ name }) => ({ message: 'Hello, ' + name + '!' }),
})

const PORT = 3199
const server = new GlyphServer({ port: PORT })
server.register(greet)
await server.start()

const client = new GlyphClient({ baseUrl: 'http://localhost:' + PORT })
await client.connect()
const envelope = await client.call('greet', { name: 'Smoke' })

if (envelope.payload.message !== 'Hello, Smoke!') {
  console.error('unexpected payload:', envelope.payload)
  process.exit(1)
}
if (!verifyReceipt(envelope.receipt)) {
  console.error('receipt did not verify')
  process.exit(1)
}
console.log('round-trip ok:', envelope.payload.message)
process.exit(0)
`

console.log('[smoke] building all packages…')
run('pnpm', ['-r', 'build'], repoRoot)

const work = mkdtempSync(join(tmpdir(), 'glyph-smoke-'))
const tarDir = join(work, 'tarballs')
const proj = join(work, 'project')
mkdirSync(tarDir, { recursive: true })
mkdirSync(proj, { recursive: true })

try {
  // `pnpm.overrides` forces *every* @glyphp/* spec — including the transitive
  // version-range ones inside each tarball (`@glyphp/server` -> `@glyphp/core`)
  // — to resolve to the local tarball instead of the npm registry. Direct
  // `file:` deps alone do not: pnpm would still fetch a transitive
  // `@glyphp/core@<version>` from the registry.
  // npm resolves file: deps and their transitive deps from the local tarball,
  // no overrides needed.
  const tarballOf = {}
  for (const dir of PKG_DIRS) {
    const pkgPath = join(repoRoot, dir)
    const { name, version } = JSON.parse(readFileSync(join(pkgPath, 'package.json'), 'utf8'))
    run('pnpm', ['pack', '--pack-destination', tarDir], pkgPath)
    const tarball = `${name.replace('@', '').replace('/', '-')}-${version}.tgz`
    tarballOf[name] = `file:${join(tarDir, tarball)}`
    console.log(`[smoke] packed ${name}@${version}`)
  }

  const deps = {}
  for (const dir of PKG_DIRS) {
    const { name } = JSON.parse(readFileSync(join(repoRoot, dir, 'package.json'), 'utf8'))
    if (name !== '@glyphp/cli') deps[name] = tarballOf[name]
  }
  deps['zod'] = '^3.23.8'

  writeFileSync(
    join(proj, 'package.json'),
    `${JSON.stringify(
      {
        name: 'glyph-smoke',
        private: true,
        type: 'module',
        dependencies: deps,
      },
      null,
      2,
    )}\n`,
  )
  writeFileSync(join(proj, 'smoke.mjs'), SMOKE_APP)

  console.log('[smoke] installing tarballs into an external project…')
  // Use npm — pnpm overrides do not reliably override transitive version
  // specs inside tarball package.json files.
  run('npm', ['install', '--install-strategy', 'nested', '--legacy-peer-deps'], proj)

  console.log('[smoke] running the server <-> client round-trip…')
  console.log(run('node', ['smoke.mjs'], proj))

  console.log('[smoke] PASS')
} finally {
  rmSync(work, { recursive: true, force: true })
}
