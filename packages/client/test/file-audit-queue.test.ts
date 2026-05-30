import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { computeGlyphId, diffCards, generateKeyPair, signGlyph } from '@glyphp/core'
import type { GlyphCard } from '@glyphp/types'
import { FilePendingAuditQueue, type PendingAuditEntry } from '../src/index.js'

function makeCard(input?: Record<string, unknown>): GlyphCard {
  const keyPair = generateKeyPair()
  const partial = {
    version: '1.0.0',
    name: 'refund-payment',
    intent: 'Refund a payment',
    tags: ['billing'],
    cost: {
      latency: 'fast',
      sideEffects: true,
      reversible: false,
      riskTier: 'safe',
      requiresConfirmation: false,
    },
    idempotent: false,
    input: input ?? { type: 'object' },
    output: { type: 'object' },
    examples: [],
    failureModes: [],
    provider: 'acme.payments',
  } satisfies Omit<GlyphCard, 'id' | 'signature' | 'createdAt' | 'publicKey'>
  const card: GlyphCard = {
    ...partial,
    id: computeGlyphId(partial),
    createdAt: '2026-05-22T00:00:00.000Z',
    publicKey: keyPair.publicKey,
  }
  card.signature = signGlyph(card, keyPair.privateKey)
  return card
}

function entry(): PendingAuditEntry {
  const v1 = makeCard()
  const v2 = makeCard({ type: 'object', properties: { amount: { type: 'number' } } })
  return {
    toolName: v2.name,
    newCard: v2,
    diff: diffCards(v1, v2),
    detectedAt: '2026-05-22T00:00:00.000Z',
  }
}

test('FilePendingAuditQueue round-trips enqueue/get/list/remove and persists', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'glyph-aq-'))
  const path = join(dir, 'pending-audits.json')
  try {
    const q = new FilePendingAuditQueue(path)
    const e = entry()
    await q.enqueue(e)

    assert.equal((await q.get(e.toolName))?.newCard.id, e.newCard.id)
    assert.equal((await q.list()).length, 1)

    // A fresh instance reads the same persisted file.
    const reopened = new FilePendingAuditQueue(path)
    assert.equal((await reopened.list()).length, 1)

    await reopened.remove(e.toolName)
    assert.equal((await new FilePendingAuditQueue(path).list()).length, 0)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('FilePendingAuditQueue returns empty list when the file does not exist', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'glyph-aq-'))
  try {
    const q = new FilePendingAuditQueue(join(dir, 'nope.json'))
    assert.deepEqual(await q.list(), [])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
