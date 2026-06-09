import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { test } from 'node:test'
import { GlyphClient } from '@glyphp/client'
import { computeGlyphId, generateKeyPair, signGlyph } from '@glyphp/core'
import type { CardAttestation, GlyphCard } from '@glyphp/types'
import { bundleToJSON, toDSSEBundle } from '@sigstore/bundle'
import { type TrustMaterial, toTrustMaterial } from '@sigstore/verify'
import { SigstoreBundleVerifier } from '../src/index.js'

// End-to-end: the SAME `requireAttestation: 'danger'` gate that, in
// examples/08, refused a structure-only SLSA bundle (`trusted: false`) now
// OPENS for a cryptographically-verified Sigstore bundle (`trusted: true`).
// This is the concrete proof of the RFC-0008 §4.1 step-3 upgrade.

const SUBJECT_DIGEST = 'a'.repeat(64)
const PAYLOAD_TYPE = 'application/vnd.in-toto+json'

function pae(type: string, body: Buffer): Buffer {
  return Buffer.concat([
    Buffer.from(`DSSEv1 ${Buffer.byteLength(type)} ${type} ${body.length} `, 'utf8'),
    body,
  ])
}

function makeBundleJSON(privateKey: crypto.KeyObject, subjectName: string): string {
  const statement = Buffer.from(
    JSON.stringify({
      _type: 'https://in-toto.io/Statement/v1',
      subject: [{ name: subjectName, digest: { sha256: SUBJECT_DIGEST } }],
      predicateType: 'https://slsa.dev/provenance/v1',
      predicate: { builder: { id: 'https://github.com/acme/ci' } },
    }),
  )
  const signature = crypto.sign('sha256', pae(PAYLOAD_TYPE, statement), privateKey)
  return JSON.stringify(
    bundleToJSON(
      toDSSEBundle({ artifact: statement, artifactType: PAYLOAD_TYPE, signature, keyHint: 'k' }),
    ),
  )
}

function trustFor(publicKey: crypto.KeyObject): TrustMaterial {
  return toTrustMaterial(
    {
      mediaType: 'application/vnd.dev.sigstore.trustedroot+json;version=0.1',
      tlogs: [],
      certificateAuthorities: [],
      ctlogs: [],
      timestampAuthorities: [],
    },
    () => ({ publicKey, validFor: () => true }),
  )
}

/** A signed `danger` card carrying `attestation` (which enters the canonical id). */
function makeDangerCard(attestation: CardAttestation): GlyphCard {
  const keyPair = generateKeyPair()
  const partial = {
    version: '1.0.0',
    name: 'deploy-release',
    intent: 'Deploy a release',
    tags: ['ops'],
    cost: {
      latency: 'fast',
      sideEffects: true,
      reversible: false,
      riskTier: 'danger',
      requiresConfirmation: false,
    },
    idempotent: false,
    input: { type: 'object' },
    output: { type: 'object' },
    examples: [],
    failureModes: [],
    provider: 'acme.ops',
    attestation,
  } satisfies Omit<GlyphCard, 'id' | 'signature' | 'createdAt' | 'publicKey'>
  const card: GlyphCard = {
    ...partial,
    id: computeGlyphId(partial),
    createdAt: '2026-05-31T00:00:00.000Z',
    publicKey: keyPair.publicKey,
  }
  card.signature = signGlyph(card, keyPair.privateKey)
  return card
}

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

test('a cryptographically-verified bundle OPENS the danger gate (trusted:true)', async () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const card = makeDangerCard({
    type: 'sigstore-bundle',
    payload: makeBundleJSON(privateKey, 'deploy-release'),
  })
  const client = new GlyphClient({
    baseUrl: 'http://glyph',
    fetch: serve(card),
    requireAttestation: 'danger',
    attestationVerifiers: [
      new SigstoreBundleVerifier({
        trustMaterial: trustFor(publicKey),
        expectedSubjectDigest: SUBJECT_DIGEST,
      }),
    ],
  })
  const envelope = await client.call('deploy-release', {})
  assert.equal((envelope.payload as { ok?: boolean }).ok, true)
})

test('a bundle signed by an untrusted key keeps the danger gate CLOSED', async () => {
  const signer = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const attacker = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const card = makeDangerCard({
    type: 'sigstore-bundle',
    payload: makeBundleJSON(signer.privateKey, 'deploy-release'),
  })
  const client = new GlyphClient({
    baseUrl: 'http://glyph',
    fetch: serve(card),
    requireAttestation: 'danger',
    attestationVerifiers: [
      new SigstoreBundleVerifier({ trustMaterial: trustFor(attacker.publicKey) }),
    ],
  })
  await assert.rejects(() => client.call('deploy-release', {}), /attestation/i)
})
