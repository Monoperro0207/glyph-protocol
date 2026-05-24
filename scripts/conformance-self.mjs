#!/usr/bin/env node
/**
 * Conformance self-test.
 *
 * Spins up an in-process reference server with all four fixture glyphs and
 * a freshly-built KeyRegistry, runs the full conformance suite against it
 * (every level), and exits non-zero if anything fails.
 */
import { GlyphServer } from '@glyphp/server'
import {
  buildKeyEntry,
  buildKeyRegistry,
  generateKeyPair,
  StaticKeyRegistry,
} from '@glyphp/core'
import {
  runConformance,
  formatReport,
  FIXTURE_NAMES,
  registerFixtures,
} from '@glyphp/conformance'

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
})

console.log(formatReport(report))

if (!report.passed) {
  console.error('\nconformance:self FAILED')
  process.exit(1)
}
console.log('\nconformance:self OK')
