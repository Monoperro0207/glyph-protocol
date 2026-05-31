import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runResilientUpdateWorkflow } from '../workflow.js'

// This is the verifiable, trackable counterpart of the demo: it runs the exact
// same workflow and asserts every guarantee the narration claims.

test('resilient update workflow: live calls never block on an incoming update', async () => {
  const t = await runResilientUpdateWorkflow()
  assert.equal(t.liveCallSucceeded, true)
  assert.ok(t.callsServedDuringUpdate >= 1, 'the workflow kept calling during the update')
})

test('resilient update workflow: the unaudited new card is quarantined, not executed', async () => {
  const t = await runResilientUpdateWorkflow()
  // The new card is parked in the audit queue...
  assert.equal(t.quarantinedCardId, t.legitV2Id)
  // ...and the pin governing the tool is still the stable v1 while it is pending.
  assert.equal(t.pinWhilePending, t.v1Id)
  assert.notEqual(t.v1Id, t.legitV2Id)
})

test('resilient update workflow: the conservative default promotes nothing', async () => {
  const t = await runResilientUpdateWorkflow()
  assert.equal(t.conservativePromoted, false)
  assert.equal(t.pinAfterConservative, t.v1Id) // pin held at v1, awaiting explicit approval
})

test('resilient update workflow: a sensible policy auto-promotes the audited update', async () => {
  const t = await runResilientUpdateWorkflow()
  assert.equal(t.policyPromoted, true)
  assert.equal(t.pinAfterPromotion, t.legitV2Id) // promoted to v2 only after audit + policy
})

test('resilient update workflow: a tampered update is never promoted, even fully permissive', async () => {
  const t = await runResilientUpdateWorkflow()
  assert.equal(t.tamperedSignatureValid, false)
  assert.equal(t.tamperedPromoted, false)
  assert.equal(t.pinAfterTamper, t.v1Id) // the safe pin holds; the gate never opens
})
