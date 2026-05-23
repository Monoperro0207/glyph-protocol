import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { defineGlyph, GlyphServer } from '@glyphp/server'
import type { GlyphCard, UpdateManifest } from '@glyphp/types'
import { generateKeyPair, signManifest } from '@glyphp/core'
import {
  runPinsApprove,
  runPinsList,
  runPinsRevoke,
} from '../src/commands/pins.js'
import { runManifestVerify } from '../src/commands/manifest.js'

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
  const dir = await mkdtemp(join(tmpdir(), 'glyph-cli-pins-'))
  try {
    await fn(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('pins list reports an empty store', async () => {
  await withTempDir(async (dir) => {
    const out = await runPinsList({ file: join(dir, 'pins.json') })
    assert.equal(out.ok, true)
    assert.match(out.report, /No pins/)
  })
})

test('approve writes a pin that list can read back', async () => {
  await withTempDir(async (dir) => {
    const card = await fetchCard()
    const cardFile = join(dir, 'card.json')
    const pinFile = join(dir, 'pins.json')
    await writeFile(cardFile, JSON.stringify(card))

    const approved = await runPinsApprove(cardFile, { file: pinFile })
    assert.equal(approved.ok, true, approved.report)
    assert.match(approved.report, /Approved "greet"/)

    const listed = await runPinsList({ file: pinFile })
    assert.match(listed.report, /greet/)
    assert.match(listed.report, /approved/)
  })
})

test('revoke flips the status; approve refuses to reinstate without flag', async () => {
  await withTempDir(async (dir) => {
    const card = await fetchCard()
    const cardFile = join(dir, 'card.json')
    const pinFile = join(dir, 'pins.json')
    await writeFile(cardFile, JSON.stringify(card))
    await runPinsApprove(cardFile, { file: pinFile })

    const revoked = await runPinsRevoke('greet', {
      file: pinFile,
      reason: 'rotation',
    })
    assert.equal(revoked.ok, true)
    assert.match(revoked.report, /Revoked "greet"/)
    assert.match(revoked.report, /rotation/)

    await assert.rejects(
      runPinsApprove(cardFile, { file: pinFile }),
      /revoked/i
    )

    const reinstated = await runPinsApprove(cardFile, {
      file: pinFile,
      reinstate: true,
    })
    assert.equal(reinstated.ok, true)
  })
})

test('manifest verify passes on a self-consistent manifest', async () => {
  await withTempDir(async (dir) => {
    const keyPair = generateKeyPair()
    const partial = {
      manifestVersion: '0.1',
      toolName: 'greet',
      previousCardId: 'a'.repeat(64),
      newCardId: 'b'.repeat(64),
      reason: 'test',
      breaking: false,
      securityImpact: 'none' as const,
      issuedAt: '2026-05-22T00:00:00.000Z',
      serverPublicKey: keyPair.publicKey,
    }
    const manifest: UpdateManifest = {
      ...partial,
      signature: signManifest(partial, keyPair.privateKey),
    }
    const file = join(dir, 'manifest.json')
    await writeFile(file, JSON.stringify(manifest))

    const out = await runManifestVerify(file)
    assert.equal(out.ok, true, out.report)
    assert.match(out.report, /PASS/)
  })
})

test('manifest verify fails on a tampered manifest', async () => {
  await withTempDir(async (dir) => {
    const keyPair = generateKeyPair()
    const partial = {
      manifestVersion: '0.1',
      toolName: 'greet',
      previousCardId: 'a'.repeat(64),
      newCardId: 'b'.repeat(64),
      reason: 'test',
      breaking: false,
      securityImpact: 'none' as const,
      issuedAt: '2026-05-22T00:00:00.000Z',
      serverPublicKey: keyPair.publicKey,
    }
    const manifest: UpdateManifest = {
      ...partial,
      signature: signManifest(partial, keyPair.privateKey),
      reason: 'tampered',
    }
    const file = join(dir, 'manifest.json')
    await writeFile(file, JSON.stringify(manifest))

    const out = await runManifestVerify(file)
    assert.equal(out.ok, false)
    assert.match(out.report, /FAIL/)
  })
})
