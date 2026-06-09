import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { GlyphSigner } from '@glyphp/core'
import { Ed25519Signer, generateKeyPair, verifyGlyph } from '@glyphp/core'
import { z } from 'zod'
import { defineGlyph, GlyphServer } from '../src/index.js'

const makeEcho = () =>
  defineGlyph({
    name: 'echo',
    intent: 'Echoes the input message back',
    cost: {
      latency: 'fast',
      sideEffects: false,
      reversible: true,
      riskTier: 'safe',
      requiresConfirmation: false,
    },
    input: z.object({ msg: z.string() }),
    output: z.object({ msg: z.string() }),
    provider: 'test',
    handler: async (i) => i,
  })

/** An async-only signer (models KMS/HSM/threshold): the sync path throws. */
function asyncOnlySigner(): GlyphSigner {
  const inner = new Ed25519Signer(generateKeyPair())
  return {
    publicKey: inner.publicKey,
    signGlyph: async (card) => inner.signGlyphSync(card),
    signGlyphSync: () => {
      throw new Error('async-only signer: use registerAsync()')
    },
    signManifest: async (manifest) => inner.signManifestSync(manifest),
    signManifestSync: () => {
      throw new Error('async-only signer: sync manifest signing unsupported')
    },
    signReceipt: async (receipt) => inner.signReceipt(receipt),
  }
}

test('registerAsync signs a card that passes verifyGlyph', async () => {
  const server = new GlyphServer({ signer: asyncOnlySigner() })
  await server.registerAsync(makeEcho())
  const res = await server.fetch(new Request('http://glyph/glyphs/echo'))
  assert.equal(res.status, 200)
  const card = await res.json()
  assert.equal(verifyGlyph(card), true)
})

test('register (sync) with an async-only signer throws instead of registering', () => {
  const server = new GlyphServer({ signer: asyncOnlySigner() })
  assert.throws(() => server.register(makeEcho()), /async-only signer/)
})

test('registerAsync rejects a duplicate name', async () => {
  const server = new GlyphServer({ signer: asyncOnlySigner() })
  await server.registerAsync(makeEcho())
  await assert.rejects(() => server.registerAsync(makeEcho()), /already registered/)
})
