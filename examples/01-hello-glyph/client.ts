import { GlyphClient } from '@glyphp/client'
import { verifyGlyph } from '@glyphp/core'

const client = new GlyphClient({
  baseUrl: 'http://localhost:3100',
  consumerId: 'demo-agent',
})

// 1. Handshake
console.log('\n── Handshake ──────────────────────────────')
const session = await client.connect({ cardDepth: 'standard' })
console.log('sessionId:', session.sessionId)
console.log('cardDepth:', session.cardDepth)

// 2. Lexicon
console.log('\n── Lexicon ─────────────────────────────────')
const lexicon = await client.getLexicon()
for (const entry of lexicon) {
  console.log(`[${entry.riskTier}] ${entry.name} — ${entry.intent}`)
}

// 3. Full card
console.log('\n── Card: greet ─────────────────────────────')
const card = await client.getCard('greet', 'rich')
console.log('id:', card.id)
console.log('publicKey:', card.publicKey)
console.log('signature:', card.signature)
console.log('signature valid:', verifyGlyph(card))

// 4. call() — canonical, keeps the SealedEnvelope
console.log('\n── call() → SealedEnvelope ─────────────────')
const envelope = await client.call('greet', { name: 'World', language: 'en' })
console.log(JSON.stringify(envelope, null, 2))

// 5. invoke() — convenience, unwraps payload
console.log('\n── invoke() → payload only ─────────────────')
const result = await client.invoke<{ message: string }>('greet', {
  name: 'Mundo',
  language: 'es',
})
console.log('message:', result.message)
