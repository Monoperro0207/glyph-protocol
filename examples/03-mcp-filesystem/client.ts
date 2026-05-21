import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import { GlyphClient } from '@glyph/client'
import { GlyphResolver } from '@glyph/resolver'

const exampleDir = dirname(fileURLToPath(import.meta.url))

const client = new GlyphClient({
  baseUrl: 'http://localhost:3100',
  consumerId: 'fs-agent',
})

// 1. Handshake
console.log('\n── Handshake ───────────────────────────────')
const session = await client.connect()
console.log('sessionId:', session.sessionId)

// 2. Lexicon — the real MCP tools, now as Glyph cards
console.log('\n── Lexicon: real MCP tools, now glyphs ──────')
const lexicon = await client.getLexicon()
for (const entry of lexicon) {
  console.log(`  [${entry.riskTier}] ${entry.name}`)
}

// 3. Resolve a natural-language intent to a glyph
console.log('\n── Resolver: "list the files in a directory" ─')
const resolver = new GlyphResolver(lexicon)
const matches = await resolver.resolve('list the files in a directory', {
  limit: 3,
})
for (const match of matches) {
  console.log(`  ${match.score.toFixed(2)}  ${match.entry.name}`)
}

// 4. Call the resolved glyph on a real directory — real MCP round-trip
const best = matches[0]
console.log(`\n── Call "${best.entry.name}" on a real directory ──`)
const result = await client.invoke(best.entry.name, { path: exampleDir })
console.log(JSON.stringify(result, null, 2))
