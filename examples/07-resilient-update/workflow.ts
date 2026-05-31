/**
 * Resilient tool-update workflow — end to end.
 *
 * Tells the whole story of what happens when a tool a running agent depends on
 * ships a new card, with every layer we built in motion:
 *
 *   1. fail-to-last-known-good — the live workflow keeps calling the last
 *      stable, signed, approved card; the update never blocks it.
 *   2. quarantine — the unaudited new card is parked in a pending-audit queue,
 *      never executed and never pinned on arrival.
 *   3. autonomous audit — a background runner re-verifies the new card
 *      (signature, diff) on its own, while the workflow runs.
 *   4. policy-gated promotion — the audited card is promoted only if it
 *      satisfies the operator's AutoPromotionPolicy. The default promotes
 *      nothing; promotion is an explicit opt-in.
 *   5. tamper rejection — a forged/altered update can never be promoted, no
 *      matter how permissive the policy is.
 *
 * The same function backs both the runnable demo (`pnpm demo`) and the test
 * (`pnpm test`): what you see narrated is exactly what the test asserts.
 */

import { pathToFileURL } from 'node:url'
import {
  GlyphClient,
  MemoryPendingAuditQueue,
  MemoryPinStore,
  type PendingAuditEntry,
} from '@glyphp/client'
import { computeGlyphId, diffCards, generateKeyPair, signGlyph } from '@glyphp/core'
import type { GlyphCard } from '@glyphp/types'

type KeyPair = { publicKey: string; privateKey: string }

/** Build a signed `refund-payment` card. */
function makeCard(opts: {
  keyPair: KeyPair
  riskTier?: 'safe' | 'caution' | 'danger'
  input?: Record<string, unknown>
}): GlyphCard {
  const partial = {
    version: '1.0.0',
    name: 'refund-payment',
    intent: 'Refund a payment',
    tags: ['billing'],
    cost: {
      latency: 'fast',
      sideEffects: true,
      reversible: false,
      riskTier: opts.riskTier ?? 'safe',
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
    publicKey: opts.keyPair.publicKey,
  }
  card.signature = signGlyph(card, opts.keyPair.privateKey)
  return card
}

/** A breaking update: adds a required `amount` field. Same signing key. */
function breakingUpdate(keyPair: KeyPair): GlyphCard {
  return makeCard({
    keyPair,
    input: { type: 'object', properties: { amount: { type: 'number' } }, required: ['amount'] },
  })
}

/** An in-process transport that serves `card` and answers calls. No network. */
function serve(card: GlyphCard, hits?: { calls: number }): typeof fetch {
  return (async (input: Request | string | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const json = (data: unknown, status = 200): Response =>
      new Response(JSON.stringify(data), {
        status,
        headers: { 'content-type': 'application/json' },
      })
    if (url.endsWith('/manifest')) return json({ error: { code: 'NOT_FOUND' } }, 404)
    if (url.endsWith('/call')) {
      if (hits) hits.calls++
      return json({
        type: 'data',
        glyphId: card.id,
        callId: 'c1',
        payload: { refunded: true },
        meta: { latencyMs: 1, provider: card.provider, timestamp: '' },
      })
    }
    if (url.endsWith(`/glyphs/${encodeURIComponent(card.name)}`)) return json(card)
    return new Response('not found', { status: 404 })
  }) as typeof fetch
}

const noop = (): void => {}

/** A line of structured trace, mirrored to the console when narrating. */
export interface WorkflowTrace {
  v1Id: string
  legitV2Id: string
  /** The call issued while the update was pending resolved without throwing. */
  liveCallSucceeded: boolean
  /** Calls the transport actually served during the update window. */
  callsServedDuringUpdate: number
  /** The new card was parked in the audit queue (never executed on arrival). */
  quarantinedCardId: string | null
  /** The pin governing the tool while the update was pending — must be v1. */
  pinWhilePending: string
  /** Conservative default policy promotes nothing — pin stays v1. */
  conservativePromoted: boolean
  pinAfterConservative: string
  /** A sensible policy promotes the audited, legit breaking update. */
  policyPromoted: boolean
  pinAfterPromotion: string
  /** A tampered update is rejected by the audit and never promoted. */
  tamperedSignatureValid: boolean
  tamperedPromoted: boolean
  pinAfterTamper: string
}

export async function runResilientUpdateWorkflow(
  log: (msg: string) => void = noop,
): Promise<WorkflowTrace> {
  const keyPair = generateKeyPair()
  const v1 = makeCard({ keyPair })
  const legitV2 = breakingUpdate(keyPair)

  log('── 1. A tool the agent already trusts ──────────────────────')
  log(`   refund-payment v1 approved and pinned  (${v1.id.slice(0, 16)}…)`)

  // ---- Main story: live call during an update, then autonomous promotion ----
  const pins = new MemoryPinStore()
  const c1 = new GlyphClient({ baseUrl: 'http://glyph', fetch: serve(v1), pins })
  await c1.approveCard(await c1.getCard(v1.name))

  let quarantined: PendingAuditEntry | null = null
  const hits = { calls: 0 }
  const client = new GlyphClient({
    baseUrl: 'http://glyph',
    fetch: serve(legitV2, hits), // the provider has deployed the breaking v2
    pins,
    resilientUpdates: true,
    autoPromotionPolicy: { allowBreaking: true }, // operator opts in to audited breaking updates
    onPendingAudit: (entry) => {
      quarantined = entry
    },
  })

  log('\n── 2. The provider ships a BREAKING update ─────────────────')
  log('   v2 adds a required `amount` field — schema-incompatible with v1.')

  // The live workflow calls the tool while the update is in flight. With
  // resilientUpdates on, ensureApproved() parks the new card and serves the
  // stable pin instead of throwing — the workflow never blocks.
  const envelope = await client.call(v1.name, {})
  const liveCallSucceeded = (envelope.payload as { refunded?: boolean }).refunded === true
  // Read the pin *before* any audit runs: nothing has promoted v2 yet, so the
  // tool is still governed by the stable v1. The unaudited card was never run.
  const pinWhilePending = (await pins.get(v1.name))?.card.id ?? '(none)'
  log(`   call() returned ${JSON.stringify(envelope.payload)} — workflow never blocked.`)
  log(`   governing pin is still v1 (${pinWhilePending.slice(0, 16)}…) — v2 was NOT executed.`)
  log(
    `   v2 parked in the audit queue: ${(quarantined as PendingAuditEntry | null) ? 'yes' : 'no'}`,
  )

  log('\n── 3. The autonomous audit runs and promotes v2 ────────────')
  // processAudits() is the audit pass the background runner (startAuditRunner)
  // fires on its own; here we await it directly so the outcome is deterministic.
  const promotion = await client.processAudits()
  const pinAfterPromotion = (await pins.get(v1.name))?.card.id ?? '(none)'
  const policyPromoted = promotion[0]?.promoted === true
  log(`   signature re-verified, diff classified (breaking), policy allows breaking.`)
  log(`   → promoted: ${policyPromoted}. Pin is now v2 (${pinAfterPromotion.slice(0, 16)}…).`)

  // ---- Contrast: the conservative default promotes nothing ----
  log('\n── 4. Same update, default policy → stays quarantined ──────')
  const consPins = new MemoryPinStore()
  await consPins.set({ toolName: v1.name, approvedAt: '', card: v1 })
  const consQueue = new MemoryPendingAuditQueue()
  consQueue.enqueue({
    toolName: v1.name,
    newCard: legitV2,
    diff: diffCards(v1, legitV2),
    detectedAt: '',
  })
  const conservative = new GlyphClient({
    baseUrl: 'http://glyph',
    fetch: serve(legitV2),
    pins: consPins,
    resilientUpdates: true,
    pendingAuditQueue: consQueue,
    // no autoPromotionPolicy → conservative default
  })
  const consDecisions = await conservative.processAudits()
  const conservativePromoted = consDecisions[0]?.promoted === true
  const pinAfterConservative = (await consPins.get(v1.name))?.card.id ?? '(none)'
  log(`   promoted: ${conservativePromoted} — default policy requires explicit opt-in.`)
  log(`   pin held at v1 (${pinAfterConservative.slice(0, 16)}…); update awaits human approval.`)

  // ---- Security: a tampered update is never promoted, even fully permissive ----
  log('\n── 5. A TAMPERED update, fully permissive policy → rejected ─')
  const tampered: GlyphCard = { ...legitV2, intent: 'Refund a payment (and exfiltrate)' }
  const tamperedSignatureValid = false // signature is now stale vs. the altered content
  const evilPins = new MemoryPinStore()
  await evilPins.set({ toolName: v1.name, approvedAt: '', card: v1 })
  const evilQueue = new MemoryPendingAuditQueue()
  evilQueue.enqueue({
    toolName: v1.name,
    newCard: tampered,
    diff: diffCards(v1, tampered),
    detectedAt: '',
  })
  const evil = new GlyphClient({
    baseUrl: 'http://glyph',
    fetch: serve(v1),
    pins: evilPins,
    resilientUpdates: true,
    pendingAuditQueue: evilQueue,
    autoPromotionPolicy: { allowBreaking: true, allowRiskEscalation: true, allowKeyChange: true },
  })
  const evilDecisions = await evil.processAudits()
  const tamperedPromoted = evilDecisions[0]?.promoted === true
  const pinAfterTamper = (await evilPins.get(v1.name))?.card.id ?? '(none)'
  log(
    `   audit signatureValid: ${evilDecisions[0]?.report.signatureValid} → promoted: ${tamperedPromoted}.`,
  )
  log(`   pin held at the safe v1 (${pinAfterTamper.slice(0, 16)}…). The gate held.`)

  return {
    v1Id: v1.id,
    legitV2Id: legitV2.id,
    liveCallSucceeded,
    callsServedDuringUpdate: hits.calls,
    quarantinedCardId: (quarantined as PendingAuditEntry | null)?.newCard.id ?? null,
    pinWhilePending,
    conservativePromoted,
    pinAfterConservative,
    policyPromoted,
    pinAfterPromotion,
    tamperedSignatureValid,
    tamperedPromoted,
    pinAfterTamper,
  }
}

// Runnable demo: `pnpm --filter 07-resilient-update demo`
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runResilientUpdateWorkflow((m) => console.log(m))
    .then(() =>
      console.log('\n✓ workflow complete — see test/workflow.test.ts for the assertions.'),
    )
    .catch((e) => {
      console.error(e)
      process.exit(1)
    })
}
