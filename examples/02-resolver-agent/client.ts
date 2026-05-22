import { GlyphClient } from '@glyph-protocol/client'
import { GlyphResolver } from '@glyph-protocol/resolver'
import { verifyGlyph } from '@glyph-protocol/core'

const client = new GlyphClient({
  baseUrl: 'http://localhost:3100',
  consumerId: 'travel-agent',
})

// 1. Handshake
console.log('\n── Handshake ───────────────────────────────')
const session = await client.connect({ cardDepth: 'standard' })
console.log('sessionId:', session.sessionId)

// 2. Lexicon — the small entries the model holds in context
console.log('\n── Lexicon ─────────────────────────────────')
const lexicon = await client.getLexicon()
for (const entry of lexicon) {
  console.log(`  [${entry.riskTier}] ${entry.name} — ${entry.intent}`)
}

// 3. Resolve natural-language intents to candidate glyphs
const resolver = new GlyphResolver(lexicon)
const queries = [
  'search for available flights',
  'get the current weather forecast',
  'convert money between currencies',
]

console.log('\n── Resolver: intent → candidate glyphs ──────')
for (const query of queries) {
  const matches = await resolver.resolve(query, { limit: 3 })
  console.log(`\n  "${query}"`)
  for (const match of matches) {
    console.log(`    ${match.score.toFixed(2)}  ${match.entry.name}`)
  }
}

// 4. Take the best match, pull its full card, verify it, and call it
console.log('\n── Resolve → pull card → verify → call ──────')
const [best] = await resolver.resolve('search for available flights', { limit: 1 })
console.log('resolved:', best.entry.name, `(score ${best.score.toFixed(2)})`)

const card = await client.getCard(best.entry.name, 'rich')
console.log('card id:', card.id)
console.log('signature valid:', verifyGlyph(card))

const envelope = await client.call(best.entry.name, {
  from: 'NYC',
  to: 'Tokyo',
  date: '2026-06-01',
})
console.log('SealedEnvelope payload:', JSON.stringify(envelope.payload))
