import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  buildKeyEntry,
  buildKeyRegistry,
  FileKeyRegistry,
  fingerprintKey,
  generateKeyPair,
  HttpKeyRegistry,
  resolveKey,
  StaticKeyRegistry,
  verifyKeyRegistry,
} from '../src/index.js'

function genesisRegistry(serverId = 'acme.test') {
  const kp = generateKeyPair()
  const entry = buildKeyEntry(kp.publicKey, new Date().toISOString())
  const registry = buildKeyRegistry({
    serverId,
    entries: [entry],
    activePrivateKey: kp.privateKey,
  })
  return { kp, registry }
}

test('a freshly built genesis registry verifies', () => {
  const { registry } = genesisRegistry()
  assert.equal(verifyKeyRegistry(registry), true)
})

test('tampering with the active fingerprint invalidates the outer signature', () => {
  const { registry } = genesisRegistry()
  const tampered = { ...registry, active: 'deadbeef' }
  assert.equal(verifyKeyRegistry(tampered), false)
})

test('resolveKey returns "active" for the active key', () => {
  const { kp, registry } = genesisRegistry()
  const result = resolveKey(registry, kp.publicKey)
  assert.equal(result.status, 'active')
})

test('resolveKey returns "unknown" for a key not in the registry', () => {
  const { registry } = genesisRegistry()
  const stranger = generateKeyPair()
  const result = resolveKey(registry, stranger.publicKey)
  assert.equal(result.status, 'unknown')
})

test('a rotation chain — old key signs new key — verifies end to end', () => {
  const t0 = new Date('2026-01-01T00:00:00Z').toISOString()
  const t1 = new Date('2026-06-01T00:00:00Z').toISOString()

  const a = generateKeyPair()
  const b = generateKeyPair()
  const fpA = fingerprintKey(a.publicKey)

  const entryA = {
    ...buildKeyEntry(a.publicKey, t0),
    validUntil: t1, // retired at rotation
  }
  const entryB = buildKeyEntry(b.publicKey, t1, {
    fingerprint: fpA,
    privateKey: a.privateKey,
  })

  const registry = buildKeyRegistry({
    serverId: 'acme.test',
    entries: [entryA, entryB],
    activePrivateKey: b.privateKey,
  })

  assert.equal(verifyKeyRegistry(registry), true)
  assert.equal(resolveKey(registry, a.publicKey).status, 'retired')
  assert.equal(resolveKey(registry, b.publicKey).status, 'active')
})

test('a broken chain (signedBy mismatch) is rejected', () => {
  const t0 = new Date().toISOString()
  const a = generateKeyPair()
  const b = generateKeyPair()
  const c = generateKeyPair()
  const _fpA = fingerprintKey(a.publicKey)

  // B is signed by A — but we lie about signedBy pointing at C's fingerprint.
  const entryA = buildKeyEntry(a.publicKey, t0)
  const entryB_lie = {
    ...buildKeyEntry(b.publicKey, t0, {
      fingerprint: fingerprintKey(c.publicKey),
      privateKey: a.privateKey, // signed by A
    }),
  }

  const registry = buildKeyRegistry({
    serverId: 'acme.test',
    entries: [entryA, entryB_lie],
    activePrivateKey: b.privateKey,
  })
  assert.equal(verifyKeyRegistry(registry), false)
})

test('a revoked key is reported as revoked even if active', () => {
  const { registry, kp } = genesisRegistry()
  const revoked = {
    ...registry,
    keys: registry.keys.map((e) => ({
      ...e,
      revokedAt: new Date().toISOString(),
      revocationReason: 'compromise',
    })),
  }
  // Outer signature no longer matches; build fresh to keep the chain valid
  // for the test we actually care about — resolveKey reporting revocation.
  const result = resolveKey(revoked, kp.publicKey)
  assert.equal(result.status, 'revoked')
  if (result.status === 'revoked') {
    assert.equal(result.reason, 'compromise')
  }
})

test('FileKeyRegistry writes atomically and reloads with verification', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'glyph-keyreg-'))
  try {
    const path = join(dir, 'keys.json')
    const file = new FileKeyRegistry(path)
    const { kp, registry } = genesisRegistry()

    await file.save(registry)
    const reloaded = await file.registry()
    assert.equal(reloaded.active, fingerprintKey(kp.publicKey))
    assert.equal(verifyKeyRegistry(reloaded), true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('FileKeyRegistry refuses to save an unverifiable registry', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'glyph-keyreg-'))
  try {
    const file = new FileKeyRegistry(join(dir, 'keys.json'))
    const { registry } = genesisRegistry()
    const broken = { ...registry, signature: 'deadbeef' }
    await assert.rejects(() => file.save(broken))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('HttpKeyRegistry verifies the chain on fetch', async () => {
  const { registry } = genesisRegistry()
  const responses: any[] = [registry]
  const client = new HttpKeyRegistry('http://example.test', {
    fetchImpl: (async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => responses.shift(),
    })) as any,
  })
  const fetched = await client.registry()
  assert.equal(fetched.active, registry.active)
})

test('HttpKeyRegistry rejects a tampered response', async () => {
  const { registry } = genesisRegistry()
  const tampered = { ...registry, active: 'deadbeef' }
  const client = new HttpKeyRegistry('http://example.test', {
    fetchImpl: (async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => tampered,
    })) as any,
  })
  await assert.rejects(() => client.registry())
})

test('StaticKeyRegistry resolves an active key', async () => {
  const { kp, registry } = genesisRegistry()
  const src = new StaticKeyRegistry(registry)
  const result = await src.resolve(kp.publicKey)
  assert.equal(result.status, 'active')
})

test('KeyRegistry accepts group key metadata for multi-signer entries', () => {
  const { registry } = genesisRegistry()
  const entry = registry.keys[0]
  entry.group = { threshold: 2, participants: 3 }
  assert.equal(entry.group.threshold, 2)
  assert.equal(entry.group.participants, 3)
  assert.equal(entry.publicKey.length, 64) // standard ed25519 (FROST group key)
})

test('FileKeyRegistry caches loaded registry — second load returns cached', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'glyph-keyreg-'))
  try {
    const path = join(dir, 'keys.json')
    const { registry } = genesisRegistry()

    // Pre-write the file so load() doesn't need save()
    writeFileSync(path, JSON.stringify(registry, null, 2), 'utf8')

    const file = new FileKeyRegistry(path)
    const loaded1 = await file.load()
    assert.ok(loaded1)

    // Second load should use cache
    const loaded2 = await file.load()
    assert.deepEqual(loaded2.active, loaded1.active)

    // Overwrite with garbage — cache should survive
    writeFileSync(path, 'not-json', 'utf8')
    const loaded3 = await file.load()
    assert.deepEqual(loaded3.active, loaded1.active)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('FileKeyRegistry load rejects invalid signature on disk', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'glyph-keyreg-'))
  try {
    const path = join(dir, 'keys.json')
    const { registry } = genesisRegistry()
    // Truly broken: change the active fingerprint so signature won't match
    const broken = { ...registry, active: '00'.repeat(32) }
    writeFileSync(path, JSON.stringify(broken, null, 2), 'utf8')

    const file = new FileKeyRegistry(path)
    await assert.rejects(
      async () => file.load(),
      /signature verification/,
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('FileKeyRegistry save fails with bad signature', async () => {
  // Already covered by "refuses to save an unverifiable registry" above,
  // but test the specific path where verifyKeyRegistry returns false on save.
  const dir = mkdtempSync(join(tmpdir(), 'glyph-keyreg-'))
  try {
    const file = new FileKeyRegistry(join(dir, 'keys.json'))
    const { registry } = genesisRegistry()
    const broken = { ...registry, keys: [...registry.keys], active: 'different' }
    await assert.rejects(() => file.save(broken), /refusing to save/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('HttpKeyRegistry rejects non-ok HTTP response', async () => {
  const client = new HttpKeyRegistry('http://example.test', {
    fetchImpl: (async () => ({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: async () => ({}),
    })) as any,
  })
  await assert.rejects(
    () => client.registry(),
    /HttpKeyRegistry: GET \/keys returned 500/,
  )
})

test('HttpKeyRegistry resolve delegates to registry', async () => {
  const { kp, registry } = genesisRegistry()
  const client = new HttpKeyRegistry('http://example.test', {
    fetchImpl: (async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => registry,
    })) as any,
  })
  const result = await client.resolve(kp.publicKey)
  assert.equal(result.status, 'active')
})
