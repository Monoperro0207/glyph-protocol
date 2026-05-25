import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  buildKeyEntry,
  buildKeyRegistry,
  generateKeyPair,
  StaticKeyRegistry,
  verifyKeyRegistry,
} from '@glyphp/core'
import { GlyphServer } from '../src/index.js'

function fixture() {
  const kp = generateKeyPair()
  const entry = buildKeyEntry(kp.publicKey, new Date().toISOString())
  const registry = buildKeyRegistry({
    serverId: 'server-test',
    entries: [entry],
    activePrivateKey: kp.privateKey,
  })
  return { kp, registry }
}

test('GET /keys returns the published registry', async () => {
  const { registry, kp } = fixture()
  const server = new GlyphServer({
    keyPair: kp,
    keyRegistry: new StaticKeyRegistry(registry),
  })
  const res = await server.fetch(new Request('http://glyph/keys'))
  assert.equal(res.status, 200)
  const body = (await res.json()) as any
  assert.equal(body.active, registry.active)
  assert.equal(verifyKeyRegistry(body), true)
})

test('GET /keys returns 404 when no registry is published', async () => {
  const server = new GlyphServer()
  const res = await server.fetch(new Request('http://glyph/keys'))
  assert.equal(res.status, 404)
  const body = (await res.json()) as any
  assert.equal(body.error.code, 'NOT_FOUND')
})

test('GET /keys signature still validates after a chained rotation', async () => {
  const t0 = new Date('2026-01-01T00:00:00Z').toISOString()
  const t1 = new Date('2026-06-01T00:00:00Z').toISOString()

  const a = generateKeyPair()
  const b = generateKeyPair()
  const entryA = { ...buildKeyEntry(a.publicKey, t0), validUntil: t1 }
  const entryB = buildKeyEntry(b.publicKey, t1, {
    fingerprint: entryA.fingerprint,
    privateKey: a.privateKey,
  })
  const registry = buildKeyRegistry({
    serverId: 'rotated.test',
    entries: [entryA, entryB],
    activePrivateKey: b.privateKey,
  })
  const server = new GlyphServer({
    keyPair: b,
    keyRegistry: new StaticKeyRegistry(registry),
  })
  const res = await server.fetch(new Request('http://glyph/keys'))
  const body = (await res.json()) as any
  assert.equal(verifyKeyRegistry(body), true)
  assert.equal(body.keys.length, 2)
})
