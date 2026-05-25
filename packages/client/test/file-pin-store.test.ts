import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { computeGlyphId, generateKeyPair, signGlyph } from '@glyphp/core'
import type { GlyphCard, Pin } from '@glyphp/types'
import { FilePinStore, GlyphClient } from '../src/index.js'

function makePin(name: string): Pin {
  const keyPair = generateKeyPair()
  const partial = {
    version: '1.0.0',
    name,
    intent: 'test',
    tags: [],
    cost: {
      latency: 'fast',
      sideEffects: false,
      reversible: true,
      riskTier: 'safe',
      requiresConfirmation: false,
    },
    idempotent: true,
    input: { type: 'object' },
    output: { type: 'object' },
    examples: [],
    failureModes: [],
    provider: 'test',
  } satisfies Omit<GlyphCard, 'id' | 'signature' | 'createdAt' | 'publicKey'>
  const card: GlyphCard = {
    ...partial,
    id: computeGlyphId(partial),
    createdAt: '2026-05-22T00:00:00.000Z',
    publicKey: keyPair.publicKey,
  }
  card.signature = signGlyph(card, keyPair.privateKey)
  return { toolName: name, approvedAt: new Date().toISOString(), card }
}

async function withTmpDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'glyph-pins-'))
  try {
    return await fn(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('FilePinStore returns undefined for a missing file', async () => {
  await withTmpDir(async (dir) => {
    const store = new FilePinStore(join(dir, 'pins.json'))
    assert.equal(await store.get('anything'), undefined)
    assert.deepEqual(await store.list(), [])
  })
})

test('FilePinStore persists writes across instances', async () => {
  await withTmpDir(async (dir) => {
    const path = join(dir, 'nested', 'pins.json')
    const a = new FilePinStore(path)
    const pin = makePin('a')
    await a.set(pin)

    const b = new FilePinStore(path)
    const loaded = await b.get('a')
    assert.equal(loaded?.toolName, 'a')
    assert.equal(loaded?.card.id, pin.card.id)
  })
})

test('FilePinStore writes are atomic — no stray .tmp left behind', async () => {
  await withTmpDir(async (dir) => {
    const path = join(dir, 'pins.json')
    const store = new FilePinStore(path)
    await store.set(makePin('one'))
    await store.set(makePin('two'))
    await store.set(makePin('three'))

    // The file is a v1 PinFile with all three pins. The .tmp must not survive.
    const raw = JSON.parse(await readFile(path, 'utf8'))
    assert.equal(raw.version, 1)
    assert.deepEqual(Object.keys(raw.pins).sort(), ['one', 'three', 'two'])
    await assert.rejects(readFile(`${path}.tmp`, 'utf8'))
  })
})

test('FilePinStore rejects a file with the wrong version', async () => {
  await withTmpDir(async (dir) => {
    const path = join(dir, 'bad.json')
    const { writeFile } = await import('node:fs/promises')
    await writeFile(path, JSON.stringify({ version: 99, pins: {} }))
    const store = new FilePinStore(path)
    await assert.rejects(store.get('anything'), /not a v1 Glyph pin file/)
  })
})

test('secureMode requires a PinStore', () => {
  assert.throws(
    () => new GlyphClient({ baseUrl: 'http://x', secureMode: true }),
    /secureMode requires a PinStore/,
  )
})

test('secureMode passes when a PinStore is configured', () => {
  assert.doesNotThrow(
    () =>
      new GlyphClient({
        baseUrl: 'http://x',
        secureMode: true,
        pins: new FilePinStore('/tmp/glyph-test-noop.json'),
      }),
  )
})
