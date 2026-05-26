#!/usr/bin/env node
/**
 * Conformance badge generator.
 *
 * Runs the full conformance suite against the in-process reference
 * server and writes a shields.io endpoint-format badge to
 * `docs/conformance-badge.json`. Designed to be re-run on every push to
 * `main` from CI so the README badge reflects the latest state.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  FIXTURE_NAMES,
  formatBadgeJson,
  registerFixtures,
  runConformance,
} from '@glyphp/conformance'
import { buildKeyEntry, buildKeyRegistry, generateKeyPair, StaticKeyRegistry } from '@glyphp/core'
import { GlyphServer } from '@glyphp/server'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

const keyPair = generateKeyPair()
const genesis = buildKeyEntry(keyPair.publicKey, new Date().toISOString())
const registry = buildKeyRegistry({
  serverId: 'conformance-badge.test',
  entries: [genesis],
  activePrivateKey: keyPair.privateKey,
})
const server = new GlyphServer({
  callTimeoutMs: 200,
  keyPair,
  keyRegistry: new StaticKeyRegistry(registry),
})
registerFixtures(server)

const report = await runConformance('http://glyph-badge', {
  fetch: server.fetch,
  fixtures: FIXTURE_NAMES,
  profile: 'production', // run all four levels including governance
})

const badge = formatBadgeJson(report)
const outDir = join(repoRoot, 'docs')
await mkdir(outDir, { recursive: true })
const outPath = join(outDir, 'conformance-badge.json')
await writeFile(outPath, `${JSON.stringify(badge, null, 2)}\n`)

console.log(`wrote ${outPath}: ${JSON.stringify(badge)}`)
if (!report.passed) {
  console.error('conformance suite FAILED — badge marks "failing"')
  process.exit(1)
}
