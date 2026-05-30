import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { FilePendingAuditQueue } from '@glyphp/client'
import { computeGlyphId, diffCards, generateKeyPair, signGlyph } from '@glyphp/core'
import type { GlyphCard } from '@glyphp/types'
import { runAuditList } from '../src/commands/audit.js'

function makeCard(
  opts: { input?: Record<string, unknown>; keyPair?: ReturnType<typeof generateKeyPair> } = {},
): GlyphCard {
  const keyPair = opts.keyPair ?? generateKeyPair()
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
    input: opts.input ?? { type: 'object' },
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

test('runAuditList reports an empty queue', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'glyph-audit-'))
  try {
    const { ok, report } = await runAuditList({ file: join(dir, 'none.json') })
    assert.equal(ok, true)
    assert.match(report, /No pending audits/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('runAuditList lists a parked breaking update and exits non-ok', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'glyph-audit-'))
  const path = join(dir, 'pending-audits.json')
  try {
    const keyPair = generateKeyPair()
    const v1 = makeCard({ keyPair })
    const v2 = makeCard({
      keyPair,
      input: { type: 'object', properties: { amount: { type: 'number' } }, required: ['amount'] },
    })
    const queue = new FilePendingAuditQueue(path)
    await queue.enqueue({
      toolName: v2.name,
      newCard: v2,
      diff: diffCards(v1, v2),
      detectedAt: '2026-05-22T00:00:00.000Z',
    })

    const { ok, report } = await runAuditList({ file: path })
    // A breaking change awaiting review → ok is false (gate-friendly exit code).
    assert.equal(ok, false)
    assert.match(report, /refund-payment/)
    assert.match(report, /BREAKING/)
    assert.match(report, new RegExp(v2.id))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
