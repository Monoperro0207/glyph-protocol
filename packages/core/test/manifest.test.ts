import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { UpdateManifest } from '@glyphp/types'
import { MANIFEST_VERSION } from '@glyphp/types'
import { generateKeyPair, signManifest, verifyManifest } from '../src/index.js'

function makeManifest(keyPair = generateKeyPair()): UpdateManifest {
  const base: Omit<UpdateManifest, 'signature'> = {
    manifestVersion: MANIFEST_VERSION,
    toolName: 'refund-payment',
    previousCardId: 'aaa111',
    newCardId: 'bbb222',
    reason: 'Added pagination',
    breaking: false,
    securityImpact: 'none',
    issuedAt: '2026-05-22T00:00:00.000Z',
    serverPublicKey: keyPair.publicKey,
  }
  return { ...base, signature: signManifest(base, keyPair.privateKey) }
}

test('verifyManifest accepts a freshly signed manifest', () => {
  assert.equal(verifyManifest(makeManifest()), true)
})

test('verifyManifest rejects a manifest with tampered content', () => {
  const manifest = makeManifest()
  assert.equal(verifyManifest({ ...manifest, newCardId: 'ccc333' }), false)
  assert.equal(verifyManifest({ ...manifest, breaking: true }), false)
})

test('verifyManifest rejects a manifest with no signature', () => {
  assert.equal(verifyManifest({ ...makeManifest(), signature: '' }), false)
})

test('verifyManifest rejects a manifest re-signed by a different key', () => {
  const manifest = makeManifest()
  // Keep the content and signature, swap the embedded key.
  const swapped = { ...manifest, serverPublicKey: generateKeyPair().publicKey }
  assert.equal(verifyManifest(swapped), false)
})
