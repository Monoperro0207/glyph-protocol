import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { defineGlyph, GlyphServer } from '@glyphp/server'
import type { GlyphCard, HandshakeResponse } from '@glyphp/types'
import { runVerify } from '../src/commands/verify.js'
import { runDiffCard } from '../src/commands/diff.js'
import { runInit } from '../src/commands/init.js'
import { formatCard, formatOverview } from '../src/commands/inspect.js'

// A real, server-signed card to verify against.
const server = new GlyphServer()
server.register(
  defineGlyph({
    name: 'greet',
    intent: 'Greets someone',
    cost: {
      latency: 'fast',
      sideEffects: false,
      reversible: true,
      riskTier: 'safe',
      requiresConfirmation: false,
    },
    input: z.object({ name: z.string() }),
    output: z.object({ greeting: z.string() }),
    provider: 'test',
    handler: async () => ({ greeting: 'hi' }),
  })
)

async function fetchCard(): Promise<GlyphCard> {
  const res = await server.fetch(
    new Request('http://glyph/glyphs/greet?depth=rich')
  )
  return (await res.json()) as GlyphCard
}

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'glyph-cli-'))
  try {
    await fn(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('verify accepts a valid signed card from a file', async () => {
  await withTempDir(async (dir) => {
    const file = join(dir, 'card.json')
    await writeFile(file, JSON.stringify(await fetchCard()))
    const result = await runVerify(file)
    assert.equal(result.ok, true, result.report)
  })
})

test('verify rejects a tampered card', async () => {
  await withTempDir(async (dir) => {
    const card = await fetchCard()
    card.intent = 'something else entirely'
    const file = join(dir, 'card.json')
    await writeFile(file, JSON.stringify(card))
    const result = await runVerify(file)
    assert.equal(result.ok, false)
  })
})

test('diff-card reports identical cards as a pass', async () => {
  await withTempDir(async (dir) => {
    const file = join(dir, 'card.json')
    await writeFile(file, JSON.stringify(await fetchCard()))
    const result = await runDiffCard(file, file)
    assert.equal(result.ok, true, result.report)
    assert.match(result.report, /identical/)
  })
})

test('diff-card flags a breaking change and fails', async () => {
  await withTempDir(async (dir) => {
    const oldCard = await fetchCard()
    const newCard = await fetchCard()
    newCard.cost = { ...newCard.cost, riskTier: 'danger' }
    const oldFile = join(dir, 'old.json')
    const newFile = join(dir, 'new.json')
    await writeFile(oldFile, JSON.stringify(oldCard))
    await writeFile(newFile, JSON.stringify(newCard))
    const result = await runDiffCard(oldFile, newFile)
    assert.equal(result.ok, false)
    assert.match(result.report, /cost\.riskTier/)
    assert.match(result.report, /BREAKING/)
  })
})

test('init scaffolds a project and refuses to overwrite', async () => {
  await withTempDir(async (dir) => {
    const target = join(dir, 'proj')
    await runInit(target)
    const files = await readdir(target)
    assert.ok(files.includes('package.json'))
    assert.ok(files.includes('server.ts'))
    assert.ok(files.includes('tsconfig.json'))
    await assert.rejects(() => runInit(target), /already contains a project/)
  })
})

test('formatOverview renders the lexicon', () => {
  const handshake: HandshakeResponse = {
    protocolVersion: '0.1',
    sessionId: 's1',
    cardDepth: 'standard',
    serverVersion: '0.1.0',
    lexicon: [
      {
        id: 'a',
        name: 'send-email',
        intent: 'Sends an email',
        tags: ['email'],
        riskTier: 'caution',
      },
    ],
  }
  const out = formatOverview('http://glyph', handshake)
  assert.match(out, /protocol 0\.1/)
  assert.match(out, /\[caution\] send-email/)
})

test('formatCard reports the signature status', async () => {
  const out = formatCard(await fetchCard())
  assert.match(out, /signature:\s+OK/)
})
