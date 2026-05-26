import assert from 'node:assert/strict'
import { test } from 'node:test'
import { computeGlyphId } from '@glyphp/core'
import type { CardAttestation, GlyphCard } from '@glyphp/types'
import { GlyphClient, MemoryPinStore } from '../src/index.js'
import { SigstoreVerifier, SlsaVerifier } from '../src/attestation.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildCard(
  opts: {
    riskTier?: 'safe' | 'caution' | 'danger'
    attestation?: CardAttestation
    name?: string
  } = {},
): GlyphCard {
  const partial = {
    version: '1.0.0',
    name: opts.name ?? 'test-tool',
    intent: 'test tool',
    tags: [],
    cost: {
      latency: 'fast' as const,
      sideEffects: false,
      reversible: true,
      riskTier: opts.riskTier ?? 'safe',
      requiresConfirmation: false,
    },
    idempotent: true,
    input: { type: 'object' },
    output: { type: 'object' },
    examples: [],
    failureModes: [],
    provider: 'test',
    attestation: opts.attestation,
  } satisfies Omit<GlyphCard, 'id' | 'signature' | 'createdAt' | 'publicKey'>

  return {
    ...partial,
    id: computeGlyphId(partial),
    createdAt: '2026-05-25T00:00:00.000Z',
  } as GlyphCard
}

/** Fetch stub that serves a card for GET /glyphs/{name} and a call envelope for POST /call */
function serve(card: GlyphCard): typeof fetch {
  return async (input) => {
    const url = (input as Request).url
    const json = (data: unknown): Response =>
      new Response(JSON.stringify(data), {
        headers: { 'content-type': 'application/json' },
      })
    if (url.endsWith('/call')) {
      return json({
        type: 'data',
        glyphId: card.id,
        callId: 'c1',
        payload: { ok: true },
        meta: { latencyMs: 1, provider: card.provider, timestamp: '' },
      })
    }
    if (url.endsWith(`/glyphs/${encodeURIComponent(card.name)}`)) {
      return json(card)
    }
    return new Response('not found', { status: 404 })
  }
}

// ---------------------------------------------------------------------------
// Task 3.1 — SigstoreVerifier
// ---------------------------------------------------------------------------

test('SigstoreVerifier: valid Sigstore bundle structure → passes', async () => {
  const verifier = new SigstoreVerifier()
  const bundle = {
    mediaType: 'application/vnd.dev.sigstore.bundle.v0.3+json',
    verificationMaterial: {
      certificate: { rawBytes: 'base64-cert-data' },
    },
    messageSignature: {
      messageDigest: {
        algorithm: 'SHA2_256',
        digest: 'abc123',
      },
      signature: 'base64-sig-data',
    },
  }
  const card = buildCard({
    attestation: {
      type: 'sigstore-bundle',
      payload: JSON.stringify(bundle),
    },
  })
  const result = await verifier.verify(card)
  assert.equal(result.valid, true)
  assert.equal(result.type, 'sigstore')
})

test('SigstoreVerifier: missing mediaType → fails', async () => {
  const verifier = new SigstoreVerifier()
  const bundle = {
    verificationMaterial: {},
    messageSignature: {},
  }
  const card = buildCard({
    attestation: {
      type: 'sigstore-bundle',
      payload: JSON.stringify(bundle),
    },
  })
  const result = await verifier.verify(card)
  assert.equal(result.valid, false)
  assert.ok(result.error, 'should have error message')
})

test('SigstoreVerifier: missing verificationMaterial → fails', async () => {
  const verifier = new SigstoreVerifier()
  const bundle = {
    mediaType: 'application/vnd.dev.sigstore.bundle.v0.3+json',
    messageSignature: {},
  }
  const card = buildCard({
    attestation: {
      type: 'sigstore-bundle',
      payload: JSON.stringify(bundle),
    },
  })
  const result = await verifier.verify(card)
  assert.equal(result.valid, false)
})

test('SigstoreVerifier: missing messageSignature → fails', async () => {
  const verifier = new SigstoreVerifier()
  const bundle = {
    mediaType: 'application/vnd.dev.sigstore.bundle.v0.3+json',
    verificationMaterial: {},
  }
  const card = buildCard({
    attestation: {
      type: 'sigstore-bundle',
      payload: JSON.stringify(bundle),
    },
  })
  const result = await verifier.verify(card)
  assert.equal(result.valid, false)
})

test('SigstoreVerifier: no attestation on card → fails', async () => {
  const verifier = new SigstoreVerifier()
  const card = buildCard()
  const result = await verifier.verify(card)
  assert.equal(result.valid, false)
  assert.ok(result.error, 'should have error message')
})

test('SigstoreVerifier: invalid JSON payload → fails', async () => {
  const verifier = new SigstoreVerifier()
  const card = buildCard({
    attestation: {
      type: 'sigstore-bundle',
      payload: 'not-valid-json{{{',
    },
  })
  const result = await verifier.verify(card)
  assert.equal(result.valid, false)
  assert.ok(result.error, 'should have error message')
})

test('SigstoreVerifier: reports crypto limitation in details', async () => {
  const verifier = new SigstoreVerifier()
  const bundle = {
    mediaType: 'application/vnd.dev.sigstore.bundle.v0.3+json',
    verificationMaterial: {
      certificate: { rawBytes: 'base64-cert-data' },
    },
    messageSignature: {
      messageDigest: { algorithm: 'SHA2_256', digest: 'abc123' },
      signature: 'base64-sig-data',
    },
  }
  const card = buildCard({
    attestation: {
      type: 'sigstore-bundle',
      payload: JSON.stringify(bundle),
    },
  })
  const result = await verifier.verify(card)
  assert.equal(result.valid, true)
  assert.ok(
    typeof result.details?.limitation === 'string',
    'should note crypto limitation',
  )
})

// ---------------------------------------------------------------------------
// Task 3.2 — SlsaVerifier
// ---------------------------------------------------------------------------

test('SlsaVerifier: valid SLSA v1 provenance → passes', async () => {
  const verifier = new SlsaVerifier()
  const provenance = {
    predicateType: 'https://slsa.dev/provenance/v1',
    predicate: {
      builder: { id: 'https://github.com/actions/runner' },
      buildDefinition: {
        buildType: 'https://slsa.dev/container-based/v1',
      },
    },
    subject: [
      {
        name: 'test-tool',
        digest: { sha256: 'a'.repeat(64) },
      },
    ],
  }
  const card = buildCard({
    attestation: {
      type: 'slsa-provenance',
      payload: JSON.stringify(provenance),
    },
  })
  const result = await verifier.verify(card)
  assert.equal(result.valid, true)
  assert.equal(result.type, 'slsa')
  assert.ok(result.details?.builder, 'should include builder info')
})

test('SlsaVerifier: wrong predicateType → fails', async () => {
  const verifier = new SlsaVerifier()
  const provenance = {
    predicateType: 'https://example.com/custom/v1',
    predicate: {
      builder: { id: 'https://github.com/actions/runner' },
    },
    subject: [
      {
        name: 'test-tool',
        digest: { sha256: 'a'.repeat(64) },
      },
    ],
  }
  const card = buildCard({
    attestation: {
      type: 'slsa-provenance',
      payload: JSON.stringify(provenance),
    },
  })
  const result = await verifier.verify(card)
  assert.equal(result.valid, false)
  assert.ok(result.error, 'should have error message')
})

test('SlsaVerifier: missing builder.id → fails', async () => {
  const verifier = new SlsaVerifier()
  const provenance = {
    predicateType: 'https://slsa.dev/provenance/v1',
    predicate: {},
    subject: [
      {
        name: 'test-tool',
        digest: { sha256: 'a'.repeat(64) },
      },
    ],
  }
  const card = buildCard({
    attestation: {
      type: 'slsa-provenance',
      payload: JSON.stringify(provenance),
    },
  })
  const result = await verifier.verify(card)
  assert.equal(result.valid, false)
})

test('SlsaVerifier: no subject array → fails', async () => {
  const verifier = new SlsaVerifier()
  const provenance = {
    predicateType: 'https://slsa.dev/provenance/v1',
    predicate: {
      builder: { id: 'https://github.com/actions/runner' },
    },
  }
  const card = buildCard({
    attestation: {
      type: 'slsa-provenance',
      payload: JSON.stringify(provenance),
    },
  })
  const result = await verifier.verify(card)
  assert.equal(result.valid, false)
})

test('SlsaVerifier: subject with non-sha256 digest → still validates structure', async () => {
  const verifier = new SlsaVerifier()
  const provenance = {
    predicateType: 'https://slsa.dev/provenance/v1',
    predicate: {
      builder: { id: 'https://github.com/actions/runner' },
    },
    subject: [
      {
        name: 'test-tool',
        digest: { sha512: 'b'.repeat(128) },
      },
    ],
  }
  const card = buildCard({
    attestation: {
      type: 'slsa-provenance',
      payload: JSON.stringify(provenance),
    },
  })
  const result = await verifier.verify(card)
  // sha256 field is missing, but sha512 is present — verifier should note this
  assert.equal(result.valid, false)
})

test('SlsaVerifier: no attestation on card → fails', async () => {
  const verifier = new SlsaVerifier()
  const card = buildCard()
  const result = await verifier.verify(card)
  assert.equal(result.valid, false)
})

test('SlsaVerifier: invalid JSON payload → fails', async () => {
  const verifier = new SlsaVerifier()
  const card = buildCard({
    attestation: {
      type: 'slsa-provenance',
      payload: 'not-valid-json{{{',
    },
  })
  const result = await verifier.verify(card)
  assert.equal(result.valid, false)
  assert.ok(result.error, 'should have error message')
})

// ---------------------------------------------------------------------------
// Task 3.3 — Client attestation policy
// ---------------------------------------------------------------------------

test('requireAttestation: "none" — unattested card works (backward compat)', async () => {
  const card = buildCard()
  const client = new GlyphClient({
    baseUrl: 'http://glyph',
    fetch: serve(card),
    requireAttestation: 'none',
  })
  const result = await client.call<{ ok: boolean }>(card.name, {})
  assert.equal((result.payload as { ok: boolean }).ok, true)
})

test('requireAttestation: "danger" + danger card without attestation → rejected', async () => {
  const card = buildCard({ riskTier: 'danger' })
  const client = new GlyphClient({
    baseUrl: 'http://glyph',
    fetch: serve(card),
    requireAttestation: 'danger',
  })
  await assert.rejects(
    () => client.call(card.name, {}),
    /attestation/i,
    'danger card without attestation should be rejected',
  )
})

test('requireAttestation: "danger" + safe card without attestation → allowed', async () => {
  const card = buildCard({ riskTier: 'safe' })
  const client = new GlyphClient({
    baseUrl: 'http://glyph',
    fetch: serve(card),
    requireAttestation: 'danger',
  })
  const result = await client.call(card.name, {})
  assert.equal((result.payload as { ok: boolean }).ok, true)
})

test('requireAttestation: "danger" + caution card without attestation → allowed', async () => {
  const card = buildCard({ riskTier: 'caution' })
  const client = new GlyphClient({
    baseUrl: 'http://glyph',
    fetch: serve(card),
    requireAttestation: 'danger',
  })
  const result = await client.call(card.name, {})
  assert.equal((result.payload as { ok: boolean }).ok, true)
})

test('requireAttestation: "all" + unattested card → rejected', async () => {
  const card = buildCard()
  const client = new GlyphClient({
    baseUrl: 'http://glyph',
    fetch: serve(card),
    requireAttestation: 'all',
  })
  await assert.rejects(
    () => client.call(card.name, {}),
    /attestation/i,
    'unattested card with "all" policy should be rejected',
  )
})

test('requireAttestation: "all" + validly attested card → allowed', async () => {
  const card = buildCard({
    riskTier: 'safe',
    attestation: {
      type: 'slsa-provenance',
      payload: JSON.stringify({
        predicateType: 'https://slsa.dev/provenance/v1',
        predicate: {
          builder: { id: 'https://github.com/actions/runner' },
        },
        subject: [
          {
            name: 'test-tool',
            digest: { sha256: 'a'.repeat(64) },
          },
        ],
      }),
    },
  })
  const client = new GlyphClient({
    baseUrl: 'http://glyph',
    fetch: serve(card),
    requireAttestation: 'all',
  })
  const result = await client.call(card.name, {})
  assert.equal((result.payload as { ok: boolean }).ok, true)
})

test('requireAttestation: "danger" + danger card with valid attestation → allowed', async () => {
  const card = buildCard({
    riskTier: 'danger',
    attestation: {
      type: 'sigstore-bundle',
      payload: JSON.stringify({
        mediaType: 'application/vnd.dev.sigstore.bundle.v0.3+json',
        verificationMaterial: {
          certificate: { rawBytes: 'base64-cert-data' },
        },
        messageSignature: {
          messageDigest: {
            algorithm: 'SHA2_256',
            digest: 'abc123',
          },
          signature: 'base64-sig-data',
        },
      }),
    },
  })
  const client = new GlyphClient({
    baseUrl: 'http://glyph',
    fetch: serve(card),
    requireAttestation: 'danger',
  })
  const result = await client.call(card.name, {})
  assert.equal((result.payload as { ok: boolean }).ok, true)
})

test('requireAttestation: defaults to "none" (backward compatible)', async () => {
  const card = buildCard({ riskTier: 'danger' })
  const client = new GlyphClient({
    baseUrl: 'http://glyph',
    fetch: serve(card),
  })
  // No requireAttestation set → default 'none' → should work even for danger
  const result = await client.call(card.name, {})
  assert.equal((result.payload as { ok: boolean }).ok, true)
})

test('attestationVerifiers: user-provided verifier is wired through client', async () => {
  // A custom verifier that rejects everything
  const blocker = {
    type: 'blocker',
    async verify(_card: GlyphCard) {
      return { valid: false, type: 'blocker', error: 'blocked by custom verifier' }
    },
  }
  const card = buildCard({
    riskTier: 'safe',
    attestation: {
      type: 'blocker',
      payload: '{}',
    },
  })
  const client = new GlyphClient({
    baseUrl: 'http://glyph',
    fetch: serve(card),
    requireAttestation: 'all',
    attestationVerifiers: [blocker],
  })
  await assert.rejects(
    () => client.call(card.name, {}),
    /attestation/i,
    'custom verifier should reject',
  )
})

test('requireAttestation: "danger" + unattested danger card with pins → still rejected', async () => {
  // Attestation check works independently of the pin system
  const card = buildCard({ riskTier: 'danger' })
  const pins = new MemoryPinStore()
  // Approve the card so pin gate passes
  await pins.set({ toolName: card.name, approvedAt: new Date().toISOString(), card })
  const client = new GlyphClient({
    baseUrl: 'http://glyph',
    fetch: serve(card),
    pins,
    requireAttestation: 'danger',
  })
  await assert.rejects(
    () => client.call(card.name, {}),
    /attestation/i,
    'attestation check should reject even when pin gate passes',
  )
})
