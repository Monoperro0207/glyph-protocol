#!/usr/bin/env node
/**
 * Glyph Protocol — unified verifier.
 *
 *   pnpm verify        → typecheck + test + build + smoke + conformance (self)
 *   pnpm verify:full   → adds Python SDK pytest and Go SDK `go test`,
 *                        when those toolchains are available.
 *
 * Designed so a fresh clone passes a single command end-to-end.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const full = process.argv.includes('--full')

const steps = [
  { name: 'typecheck', cmd: 'pnpm', args: ['typecheck'] },
  { name: 'test', cmd: 'pnpm', args: ['test'] },
  { name: 'build', cmd: 'pnpm', args: ['build'] },
  { name: 'smoke', cmd: 'pnpm', args: ['smoke'] },
]

// Conformance:self runs the full 4-level suite against an in-process
// reference server with the standard fixture glyphs registered.
const rootPkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'))
if (rootPkg.scripts && rootPkg.scripts['conformance:self']) {
  steps.push({
    name: 'conformance:self',
    cmd: 'pnpm',
    args: ['run', 'conformance:self'],
  })
}

if (full) {
  const pythonDir = join(repoRoot, 'sdks/python')
  if (existsSync(pythonDir)) {
    steps.push({
      name: 'python sdk',
      cmd: '.venv/bin/python',
      args: ['-m', 'pytest', '-q'],
      cwd: pythonDir,
      optional: true,
    })
  }
  const goDir = join(repoRoot, 'sdks/go/glyphprotocol')
  if (existsSync(goDir)) {
    steps.push({
      name: 'go sdk',
      cmd: 'go',
      args: ['test', './...'],
      cwd: goDir,
      optional: true,
    })
  }
}

let failed = 0
for (const step of steps) {
  process.stdout.write(`\n▸ ${step.name}\n`)
  const result = spawnSync(step.cmd, step.args, {
    cwd: step.cwd ?? repoRoot,
    stdio: 'inherit',
    shell: false,
  })
  if (result.error && result.error.code === 'ENOENT') {
    if (step.optional) {
      process.stdout.write(`  (skipped — ${step.cmd} not installed)\n`)
      continue
    }
    console.error(`  ${step.cmd} not found and step is required.`)
    failed++
    continue
  }
  if (result.status !== 0) {
    if (step.optional) {
      console.warn(`  (warning — optional step ${step.name} exited ${result.status})`)
      continue
    }
    failed++
    console.error(`  ${step.name} failed (exit ${result.status}).`)
  }
}

if (failed > 0) {
  console.error(`\nverify: ${failed} step(s) failed.`)
  process.exit(1)
}
console.log('\nverify: all steps passed.')
