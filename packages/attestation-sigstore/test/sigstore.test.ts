import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { test } from 'node:test'
import type { GlyphCard } from '@glyphp/types'
import { bundleToJSON, toDSSEBundle } from '@sigstore/bundle'
import { type TrustMaterial, toTrustMaterial } from '@sigstore/verify'
import { SigstoreBundleVerifier } from '../src/index.js'

// These tests exercise the REAL @sigstore/verify cryptographic path, fully
// offline and deterministic: we mint an ECDSA key, sign a DSSE-wrapped in-toto
// statement, and verify it against injected trust material built from the
// matching public key. No network, no Fulcio, no Rekor.

const SUBJECT_DIGEST = 'a'.repeat(64)
const PAYLOAD_TYPE = 'application/vnd.in-toto+json'

function statementFor(subjectName: string): Buffer {
  return Buffer.from(
    JSON.stringify({
      _type: 'https://in-toto.io/Statement/v1',
      subject: [{ name: subjectName, digest: { sha256: SUBJECT_DIGEST } }],
      predicateType: 'https://slsa.dev/provenance/v1',
      predicate: { builder: { id: 'https://github.com/acme/ci' }, buildType: 'spike' },
    }),
  )
}

/** DSSE Pre-Authentication Encoding — the exact bytes that get signed. */
function pae(type: string, body: Buffer): Buffer {
  return Buffer.concat([
    Buffer.from(`DSSEv1 ${Buffer.byteLength(type)} ${type} ${body.length} `, 'utf8'),
    body,
  ])
}

/** Builds a serialized Sigstore DSSE bundle signed by `privateKey`. */
function signBundleJSON(
  privateKey: crypto.KeyObject,
  statement: Buffer,
  signatureOverride?: Buffer,
) {
  const signature =
    signatureOverride ?? crypto.sign('sha256', pae(PAYLOAD_TYPE, statement), privateKey)
  const bundle = toDSSEBundle({
    artifact: statement,
    artifactType: PAYLOAD_TYPE,
    signature,
    keyHint: 'spike-key',
  })
  return JSON.stringify(bundleToJSON(bundle))
}

/** Trust material whose key finder returns `publicKey` for any hint. */
function trustFor(publicKey: crypto.KeyObject): TrustMaterial {
  const emptyRoot = {
    mediaType: 'application/vnd.dev.sigstore.trustedroot+json;version=0.1',
    tlogs: [],
    certificateAuthorities: [],
    ctlogs: [],
    timestampAuthorities: [],
  }
  return toTrustMaterial(emptyRoot, () => ({ publicKey, validFor: () => true }))
}

/** A throwaway card that only carries an attestation payload. */
function cardWith(payload: string): GlyphCard {
  return { attestation: { type: 'sigstore-bundle', payload } } as unknown as GlyphCard
}

function freshKey() {
  return crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })
}

test('a genuine bundle verifies cryptographically → valid + trusted', async () => {
  const { publicKey, privateKey } = freshKey()
  const v = new SigstoreBundleVerifier({ trustMaterial: trustFor(publicKey) })
  const result = await v.verify(
    cardWith(signBundleJSON(privateKey, statementFor('deploy-release'))),
  )
  assert.equal(result.valid, true)
  assert.equal(result.trusted, true)
  assert.equal(result.details?.subjectDigest, SUBJECT_DIGEST)
})

test('a tampered payload is rejected (signature no longer matches)', async () => {
  const { publicKey, privateKey } = freshKey()
  // Sign the real statement, then swap the bundle payload for an altered one.
  const realStatement = statementFor('deploy-release')
  const realSig = crypto.sign('sha256', pae(PAYLOAD_TYPE, realStatement), privateKey)
  const tamperedJSON = signBundleJSON(privateKey, statementFor('deploy-evil-x'), realSig)
  const v = new SigstoreBundleVerifier({ trustMaterial: trustFor(publicKey) })
  const result = await v.verify(cardWith(tamperedJSON))
  assert.equal(result.valid, false)
  assert.match(result.error ?? '', /cryptographic verification failed/)
})

test('a bundle signed by a different key is rejected', async () => {
  const signer = freshKey()
  const attacker = freshKey()
  // Trust material holds the attacker's key, but the bundle is signed by `signer`.
  const v = new SigstoreBundleVerifier({ trustMaterial: trustFor(attacker.publicKey) })
  const result = await v.verify(
    cardWith(signBundleJSON(signer.privateKey, statementFor('deploy-release'))),
  )
  assert.equal(result.valid, false)
})

test('subject-digest binding: a matching expected digest passes', async () => {
  const { publicKey, privateKey } = freshKey()
  const v = new SigstoreBundleVerifier({
    trustMaterial: trustFor(publicKey),
    expectedSubjectDigest: SUBJECT_DIGEST,
  })
  const result = await v.verify(
    cardWith(signBundleJSON(privateKey, statementFor('deploy-release'))),
  )
  assert.equal(result.valid, true)
  assert.equal(result.trusted, true)
})

test('subject-digest binding: a mismatched expected digest fails closed (RFC-0008 §3.2)', async () => {
  const { publicKey, privateKey } = freshKey()
  const v = new SigstoreBundleVerifier({
    trustMaterial: trustFor(publicKey),
    expectedSubjectDigest: 'b'.repeat(64), // not the digest in the statement
  })
  const result = await v.verify(
    cardWith(signBundleJSON(privateKey, statementFor('deploy-release'))),
  )
  assert.equal(result.valid, false)
  assert.match(result.error ?? '', /subject digest .* does not match/)
})

test('a malformed (non-bundle) payload is rejected, not thrown', async () => {
  const { publicKey } = freshKey()
  const v = new SigstoreBundleVerifier({ trustMaterial: trustFor(publicKey) })
  const result = await v.verify(cardWith('{"not":"a bundle"}'))
  assert.equal(result.valid, false)
  assert.match(result.error ?? '', /malformed Sigstore bundle/)
})

test('a card with no attestation returns valid:false', async () => {
  const { publicKey } = freshKey()
  const v = new SigstoreBundleVerifier({ trustMaterial: trustFor(publicKey) })
  const result = await v.verify({} as GlyphCard)
  assert.equal(result.valid, false)
  assert.match(result.error ?? '', /no attestation/)
})
