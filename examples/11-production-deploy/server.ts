import { appendFile } from 'node:fs/promises'
import { GlyphServer, defineGlyph } from '@glyphp/server'
import {
  buildKeyEntry,
  buildKeyRegistry,
  StaticKeyRegistry,
} from '@glyphp/core'
import { registerFixtures } from '@glyphp/conformance'
import { z } from 'zod'

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required`)
  return value
}

const keyPair = {
  publicKey: required('GLYPH_PUBLIC_KEY'),
  privateKey: required('GLYPH_PRIVATE_KEY'),
}
const authToken = required('GLYPH_AUTH_TOKEN')
const auditLog = process.env.GLYPH_AUDIT_LOG ?? '/app/audit/receipts.jsonl'

// Build a single-entry KeyRegistry. Run `glyph keys rotate` to evolve it.
const genesis = buildKeyEntry(keyPair.publicKey, new Date().toISOString())
const registry = buildKeyRegistry({
  serverId: process.env.GLYPH_SERVER_ID ?? 'glyph.production',
  entries: [genesis],
  activePrivateKey: keyPair.privateKey,
})

// Your real tool — replace the `defineGlyph` below with your tools.
const echo = defineGlyph({
  name: 'echo',
  intent: 'Echoes its input — replace with your real tools',
  cost: {
    latency: 'fast',
    sideEffects: false,
    reversible: true,
    riskTier: 'safe',
    requiresConfirmation: false,
  },
  input: z.object({ value: z.string() }),
  output: z.object({ value: z.string() }),
  provider: 'production-template',
  handler: async (input) => input,
})

const server = new GlyphServer({
  port: 3100,
  keyPair,
  auth: { tokens: [authToken] },
  rateLimit: { windowMs: 60_000, max: 200 },
  callTimeoutMs: 30_000,
  keyRegistry: new StaticKeyRegistry(registry),
  onCall: (receipt) => {
    // Append-only audit trail. In production, ship this to your SIEM as well.
    appendFile(auditLog, JSON.stringify(receipt) + '\n').catch((err) => {
      console.error('[glyph] audit append failed:', err)
    })
  },
})

server.register(echo)
// Register the standard conformance fixture glyphs so external auditors
// can run `glyph-conformance` against this URL and verify all 4 levels.
registerFixtures(server)

await server.start()
