#!/usr/bin/env node
import { FIXTURE_NAMES, formatReport, registerFixtures, runConformance } from '@glyphp/conformance'
import { buildKeyEntry, buildKeyRegistry, generateKeyPair, StaticKeyRegistry } from '@glyphp/core'
/**
 * Conformance self-test.
 *
 * Spins up an in-process reference server with all four fixture glyphs and
 * a freshly-built KeyRegistry, runs the full conformance suite against it
 * (every level), and exits non-zero if anything fails.
 */
import { GlyphServer } from '@glyphp/server'

const keyPair = generateKeyPair()
const genesis = buildKeyEntry(keyPair.publicKey, new Date().toISOString())
const registry = buildKeyRegistry({
  serverId: 'conformance-self.test',
  entries: [genesis],
  activePrivateKey: keyPair.privateKey,
})
const server = new GlyphServer({
  // A 200ms timeout so the `slow` fixture trips HANDLER_TIMEOUT quickly.
  callTimeoutMs: 200,
  keyPair,
  keyRegistry: new StaticKeyRegistry(registry),
})
registerFixtures(server)

const report = await runConformance('http://glyph-self', {
  fetch: server.fetch,
  fixtures: FIXTURE_NAMES,
  profile: 'production', // run all four levels including governance
})

console.log(formatReport(report))

if (!report.passed) {
  console.error('\nconformance:self FAILED')
  process.exit(1)
}
console.log('\nconformance:self OK')
