import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runAttestationWorkflow } from '../workflow.js'

// The verifiable, trackable counterpart of the demo: it runs the exact same
// workflow and asserts every guarantee — and every honest limit — the
// narration claims.

test('attestation is opt-in: with no policy, an unattested danger tool runs', async () => {
  const t = await runAttestationWorkflow()
  assert.equal(t.noPolicyCallSucceeded, true)
})

test("policy 'danger': an unattested danger tool is refused before its handler runs", async () => {
  const t = await runAttestationWorkflow()
  assert.equal(t.unattestedRefused, true)
  assert.match(t.unattestedError, /no attestation/)
})

test("policy 'danger': a valid container-digest attestation opens the gate", async () => {
  const t = await runAttestationWorkflow()
  assert.equal(t.digestAttestedCallSucceeded, true)
})

test("policy 'danger': a malformed digest is rejected", async () => {
  const t = await runAttestationWorkflow()
  assert.equal(t.malformedDigestRefused, true)
})

test('the honest limit: a structure-only SLSA provenance is valid-but-not-trusted, so the gate stays closed', async () => {
  const t = await runAttestationWorkflow()
  assert.equal(t.slsaStructureOnlyRefused, true)
  // The refusal cites structural-only validation, not a malformed bundle.
  assert.match(t.slsaError, /structural validation only/)
})

test("tier-scoped: under a 'danger' policy, a safe tool needs no attestation", async () => {
  const t = await runAttestationWorkflow()
  assert.equal(t.safeToolUnaffected, true)
})

test('downgrade-resistant: the attestation is bound to the id, so stripping it changes the id', async () => {
  const t = await runAttestationWorkflow()
  assert.equal(t.strippingAttestationChangesId, true)
  assert.notEqual(t.idWithAttestation, t.idWithoutAttestation)
})
