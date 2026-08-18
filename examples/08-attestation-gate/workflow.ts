/**
 * Execution-attestation gate — end to end.
 *
 * A signed glyph card proves "this is the contract the publisher declared." It
 * does NOT prove "this is the code that runs behind it" (see spec/trust.md
 * "Executor integrity" and RFC-0008). `requireAttestation` is the consumer-side
 * gate that demands external evidence — produced outside the provider's process
 * — before a `danger` tool is allowed to execute.
 *
 * This workflow shows exactly what that gate does, and — just as importantly —
 * exactly where it stops today, using only shipped API:
 *
 *   1. opt-in — with no policy, an unattested `danger` tool runs as before.
 *   2. gate closed — under `requireAttestation: 'danger'`, an unattested
 *      `danger` tool is refused before its handler runs.
 *   3. gate open — a card whose `container-digest` attestation matches the
 *      consumer's pinned expected digest passes the gate and executes.
 *   4. unbound evidence — the same card, verified by a `DigestVerifier` with no
 *      `expectedDigest`, is refused. An unbound digest is a provider self-claim;
 *      it is `valid` but `trusted: false` (RFC-0008 §3.2).
 *   5. lifted evidence — a well-formed digest belonging to a *different*
 *      artifact fails the subject binding and is refused.
 *   6. malformed evidence — a broken digest is rejected.
 *   7. THE HONEST LIMIT — a structurally-valid SLSA provenance is `valid` but
 *      `trusted: false` ("structure-only validation; full cryptographic
 *      verification requires sigstore-js"), so it does NOT open the gate. To
 *      close it, use `SigstoreBundleVerifier` from
 *      `@glyphp/attestation-sigstore`, which performs the real DSSE + chain
 *      check (RFC-0008 §4.1 step 3). The example proves the gate fails *closed*
 *      on structure-only evidence rather than pretending.
 *   8. tier-scoped — under the same `danger` policy, a `safe` tool needs no
 *      attestation and runs untouched.
 *   9. bound to the id — the attestation is canonical content, so stripping it
 *      yields a different `id`: an attacker cannot quietly downgrade a pinned,
 *      attested card to an unattested one.
 *
 * The same function backs both the runnable demo (`pnpm demo`) and the test
 * (`pnpm test`): what you see narrated is exactly what the test asserts.
 */

import { pathToFileURL } from 'node:url'
import { GlyphClient } from '@glyphp/client'
import { computeGlyphId, DigestVerifier, generateKeyPair, signGlyph } from '@glyphp/core'
import type { CardAttestation, GlyphCard } from '@glyphp/types'

type KeyPair = { publicKey: string; privateKey: string }

const VALID_DIGEST = `sha256:${'a'.repeat(64)}`
/** A well-formed digest for a *different* artifact — used for the lifted-evidence case. */
const OTHER_DIGEST = `sha256:${'b'.repeat(64)}`

/** A well-formed `container-digest` attestation — the only kind that opens the gate today. */
function containerDigestAttestation(digest = VALID_DIGEST): CardAttestation {
  return { type: 'container-digest', payload: JSON.stringify({ digest }) }
}

/** A structurally-valid SLSA provenance — `valid` but `trusted: false` (structure-only). */
function slsaAttestation(): CardAttestation {
  const provenance = {
    predicateType: 'https://slsa.dev/provenance/v1',
    predicate: {
      builder: { id: 'https://github.com/acme/ci/.github/workflows/release.yml@refs/tags/v1.0.0' },
      buildDefinition: { buildType: 'https://slsa.dev/container-based-build/v0.1' },
    },
    subject: [{ name: 'deploy-release', digest: { sha256: 'a'.repeat(64) } }],
  }
  return { type: 'slsa-provenance', payload: JSON.stringify(provenance) }
}

/** Build a signed card. The attestation (when present) enters the canonical id. */
function makeCard(opts: {
  keyPair: KeyPair
  name: string
  riskTier: 'safe' | 'caution' | 'danger'
  attestation?: CardAttestation
}): GlyphCard {
  const partial = {
    version: '1.0.0',
    name: opts.name,
    intent: `Run ${opts.name}`,
    tags: ['ops'],
    cost: {
      latency: 'fast',
      sideEffects: true,
      reversible: false,
      riskTier: opts.riskTier,
      requiresConfirmation: false,
    },
    idempotent: false,
    input: { type: 'object' },
    output: { type: 'object' },
    examples: [],
    failureModes: [],
    provider: 'acme.ops',
    ...(opts.attestation ? { attestation: opts.attestation } : {}),
  } satisfies Omit<GlyphCard, 'id' | 'signature' | 'createdAt' | 'publicKey'>

  const card: GlyphCard = {
    ...partial,
    id: computeGlyphId(partial),
    createdAt: '2026-05-31T00:00:00.000Z',
    publicKey: opts.keyPair.publicKey,
  }
  card.signature = signGlyph(card, opts.keyPair.privateKey)
  return card
}

/** An in-process transport that serves `card` and answers calls. No network. */
function serve(card: GlyphCard): typeof fetch {
  return (async (input: Request | string | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const json = (data: unknown, status = 200): Response =>
      new Response(JSON.stringify(data), {
        status,
        headers: { 'content-type': 'application/json' },
      })
    if (url.endsWith('/manifest')) return json({ error: { code: 'NOT_FOUND' } }, 404)
    if (url.endsWith('/call')) {
      return json({
        type: 'data',
        glyphId: card.id,
        callId: 'c1',
        payload: { ok: true },
        meta: { latencyMs: 1, provider: card.provider, timestamp: '' },
      })
    }
    if (url.endsWith(`/glyphs/${encodeURIComponent(card.name)}`)) return json(card)
    return new Response('not found', { status: 404 })
  }) as typeof fetch
}

const noop = (): void => {}

/** Returns true if the call executed (the handler answered `{ ok: true }`). */
async function callSucceeds(client: GlyphClient, name: string): Promise<boolean> {
  try {
    const envelope = await client.call(name, {})
    return (envelope.payload as { ok?: boolean }).ok === true
  } catch {
    return false
  }
}

/** Returns whether the call was refused by the attestation gate, and the message. */
async function callRefused(
  client: GlyphClient,
  name: string,
): Promise<{ refused: boolean; error: string }> {
  try {
    await client.call(name, {})
    return { refused: false, error: '' }
  } catch (e) {
    const err = e as { name?: string; message?: string }
    return { refused: err?.name === 'GlyphAttestationError', error: String(err?.message ?? e) }
  }
}

/** The verifiable trace the demo narrates and the test asserts. */
export interface AttestationTrace {
  dangerToolName: string
  /** 1. No policy → attestation is opt-in; an unattested danger tool runs. */
  noPolicyCallSucceeded: boolean
  /** 2. Policy 'danger', card has no attestation → refused before the handler runs. */
  unattestedRefused: boolean
  unattestedError: string
  /** 3. Policy 'danger', container-digest matching the pin → gate opens. */
  digestAttestedCallSucceeded: boolean
  /** 4. Same card, verifier with no expectedDigest → unbound, refused. */
  unboundDigestRefused: boolean
  unboundDigestError: string
  /** 5. Well-formed digest for another artifact → fails the binding, refused. */
  liftedDigestRefused: boolean
  liftedDigestError: string
  /** 6. Malformed digest → rejected. */
  malformedDigestRefused: boolean
  /** 7. Structurally-valid SLSA is valid-but-not-trusted → still refused (the honest limit). */
  slsaStructureOnlyRefused: boolean
  slsaError: string
  /** 8. Same 'danger' policy, a `safe` tool needs no attestation → runs. */
  safeToolUnaffected: boolean
  /** 9. The attestation is bound to the id: stripping it changes the id. */
  idWithAttestation: string
  idWithoutAttestation: string
  strippingAttestationChangesId: boolean
}

export async function runAttestationWorkflow(
  log: (msg: string) => void = noop,
): Promise<AttestationTrace> {
  const keyPair: KeyPair = generateKeyPair()
  const name = 'deploy-release'

  // Cards: same danger tool, different attestation states. No pin store is
  // configured, so the pin gate is off and the attestation gate is isolated.
  const unattested = makeCard({ keyPair, name, riskTier: 'danger' })
  const digestAttested = makeCard({
    keyPair,
    name,
    riskTier: 'danger',
    attestation: containerDigestAttestation(),
  })
  const malformed = makeCard({
    keyPair,
    name,
    riskTier: 'danger',
    attestation: containerDigestAttestation('sha256:not-a-real-digest'),
  })
  // Well-formed evidence — for the wrong artifact. Format validation alone
  // passes it; only the subject binding catches it.
  const lifted = makeCard({
    keyPair,
    name,
    riskTier: 'danger',
    attestation: containerDigestAttestation(OTHER_DIGEST),
  })
  const slsaAttested = makeCard({
    keyPair,
    name,
    riskTier: 'danger',
    attestation: slsaAttestation(),
  })
  const safeTool = makeCard({ keyPair, name: 'list-releases', riskTier: 'safe' })

  log('── 1. Attestation is opt-in — no policy, danger tool runs ───')
  const optIn = new GlyphClient({
    baseUrl: 'http://glyph',
    fetch: serve(unattested),
    requireAttestation: 'none',
  })
  const noPolicyCallSucceeded = await callSucceeds(optIn, name)
  log(`   requireAttestation: 'none' → call executed: ${noPolicyCallSucceeded}`)

  log("\n── 2. Policy 'danger', no attestation → gate closed ────────")
  // The consumer pins the digest of the artifact it expects to serve this card
  // (RFC-0008 §3.2). Without that pin the verifier reports `trusted: false` and
  // can never open the gate — see step 4.
  const strict = (card: GlyphCard) =>
    new GlyphClient({
      baseUrl: 'http://glyph',
      fetch: serve(card),
      requireAttestation: 'danger',
      attestationVerifiers: [new DigestVerifier({ expectedDigest: VALID_DIGEST })],
    })
  const unattestedResult = await callRefused(strict(unattested), name)
  log(`   refused: ${unattestedResult.refused} — "${unattestedResult.error}"`)

  log("\n── 3. Policy 'danger', digest matches the pin → gate opens ──")
  const digestAttestedCallSucceeded = await callSucceeds(strict(digestAttested), name)
  log(
    `   DigestVerifier accepted ${VALID_DIGEST.slice(0, 20)}… → call executed: ${digestAttestedCallSucceeded}`,
  )

  log('\n── 4. Unbound verifier (no pin) → refused ──────────────────')
  const unbound = new GlyphClient({
    baseUrl: 'http://glyph',
    fetch: serve(digestAttested),
    requireAttestation: 'danger',
    attestationVerifiers: [new DigestVerifier()],
  })
  const unboundResult = await callRefused(unbound, name)
  log(`   same card, no expectedDigest → refused: ${unboundResult.refused}`)
  log(`   "${unboundResult.error}"`)

  log('\n── 5. Lifted digest (wrong artifact) → binding fails ───────')
  const liftedResult = await callRefused(strict(lifted), name)
  log(`   refused: ${liftedResult.refused} — "${liftedResult.error}"`)

  log('\n── 6. Malformed digest → rejected ──────────────────────────')
  const malformedResult = await callRefused(strict(malformed), name)
  log(`   refused: ${malformedResult.refused} — "${malformedResult.error}"`)

  log('\n── 7. THE HONEST LIMIT — structure-only SLSA is not enough ──')
  // The client auto-registers SlsaVerifier. It returns valid:true, trusted:false
  // ("structure-only; full cryptographic verification requires sigstore-js").
  // ensureAttested treats valid-but-not-trusted as INSUFFICIENT, so the gate
  // stays closed. This is exactly the gap RFC-0008 §4.1 step 3 closes.
  const slsaResult = await callRefused(strict(slsaAttested), name)
  log(`   SLSA provenance is structurally valid but trusted:false → refused: ${slsaResult.refused}`)
  log(`   "${slsaResult.error}"`)

  log('\n── 8. Tier-scoped — a `safe` tool needs no attestation ─────')
  const safeClient = new GlyphClient({
    baseUrl: 'http://glyph',
    fetch: serve(safeTool),
    requireAttestation: 'danger',
    attestationVerifiers: [new DigestVerifier({ expectedDigest: VALID_DIGEST })],
  })
  const safeToolUnaffected = await callSucceeds(safeClient, 'list-releases')
  log(`   safe tool under 'danger' policy → call executed: ${safeToolUnaffected}`)

  log('\n── 9. Bound to the id — stripping the attestation changes it ')
  const idWithAttestation = digestAttested.id
  const idWithoutAttestation = unattested.id
  const strippingAttestationChangesId = idWithAttestation !== idWithoutAttestation
  log(`   attested id  ${idWithAttestation.slice(0, 16)}…`)
  log(`   stripped id  ${idWithoutAttestation.slice(0, 16)}…`)
  log(`   different (downgrade-resistant): ${strippingAttestationChangesId}`)

  return {
    dangerToolName: name,
    noPolicyCallSucceeded,
    unattestedRefused: unattestedResult.refused,
    unattestedError: unattestedResult.error,
    digestAttestedCallSucceeded,
    unboundDigestRefused: unboundResult.refused,
    unboundDigestError: unboundResult.error,
    liftedDigestRefused: liftedResult.refused,
    liftedDigestError: liftedResult.error,
    malformedDigestRefused: malformedResult.refused,
    slsaStructureOnlyRefused: slsaResult.refused,
    slsaError: slsaResult.error,
    safeToolUnaffected,
    idWithAttestation,
    idWithoutAttestation,
    strippingAttestationChangesId,
  }
}

// Runnable demo: `pnpm --filter 08-attestation-gate demo`
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runAttestationWorkflow((m) => console.log(m))
    .then(() =>
      console.log('\n✓ workflow complete — see test/workflow.test.ts for the assertions.'),
    )
    .catch((e) => {
      console.error(e)
      process.exit(1)
    })
}
