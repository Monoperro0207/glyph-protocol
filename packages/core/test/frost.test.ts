import assert from 'node:assert/strict'
import { test } from 'node:test'
import { generateKeyPair, signGlyph, canonicalHash } from '../src/index.js'
import { Ed25519Signer } from '../src/signer.js'
import type { FrostSigner, SignerShare } from '../src/frost.js'

// WASM imports require Node >= 22 (native .wasm ESM support).
// Skip WASM-dependent tests on older runtimes — tests pass on Node 22+ in CI.
const nodeMajor = Number.parseInt(process.version.slice(1).split('.')[0], 10)
const skipWasm = nodeMajor < 22

// ---------------------------------------------------------------------------
// Ed25519Signer
// ---------------------------------------------------------------------------

test('Ed25519Signer signs a card identically to signGlyph()', () => {
  const kp = generateKeyPair()
  const signer = new Ed25519Signer(kp)

  const partial = {
    version: '1.0.0', name: 'test-tool', intent: 'Test something', tags: [],
    cost: { latency: 'fast', sideEffects: false, reversible: true, riskTier: 'safe' as const, requiresConfirmation: false },
    idempotent: false, input: { type: 'object' }, output: { type: 'object' },
    examples: [], failureModes: [], provider: 'test',
  } as any

  assert.equal(signGlyph(partial, kp.privateKey), signer.signGlyphSync(partial))
  assert.equal(signer.publicKey, kp.publicKey)
})

// ---------------------------------------------------------------------------
// FrostSigner — WASM-dependent tests (skip on Node < 22)
// ---------------------------------------------------------------------------

test('FrostSigner constructs with trusted-dealer shares', { skip: skipWasm }, async () => {
  const { generate_with_dealer, key_package_from_secret_share } = await import(
    '@myecoria/frost-ed25519-blake2b-wasm'
  )
  const dealer = generate_with_dealer(3, 2)
  const shares: SignerShare[] = [
    { index: 0, keyPackage: key_package_from_secret_share(dealer.share(0).secret_share), policy: 'auto' },
    { index: 1, keyPackage: key_package_from_secret_share(dealer.share(1).secret_share), policy: 'auto' },
    { index: 2, keyPackage: key_package_from_secret_share(dealer.share(2).secret_share), policy: 'approval-required' },
  ]

  const { FrostSigner } = await import('../src/frost.js')
  const signer = new FrostSigner({
    publicKeyPackage: dealer.public_key_package,
    shares,
    threshold: 2,
    dealerResult: dealer,
  })

  assert.equal(typeof signer.publicKey, 'string')
  assert.equal(signer.pendingApprovals.size, 0)
  signer.destroy()
})

test('FrostSigner sync methods throw', { skip: skipWasm }, async () => {
  const { generate_with_dealer, key_package_from_secret_share } = await import(
    '@myecoria/frost-ed25519-blake2b-wasm'
  )
  const dealer = generate_with_dealer(2, 2)
  const shares: SignerShare[] = [
    { index: 0, keyPackage: key_package_from_secret_share(dealer.share(0).secret_share), policy: 'auto' },
    { index: 1, keyPackage: key_package_from_secret_share(dealer.share(1).secret_share), policy: 'auto' },
  ]
  const { FrostSigner } = await import('../src/frost.js')
  const signer = new FrostSigner({
    publicKeyPackage: dealer.public_key_package,
    shares,
    threshold: 2,
    dealerResult: dealer,
  })

  assert.throws(() => signer.signGlyphSync({} as any), /requires async/)
  assert.throws(() => signer.signManifestSync({} as any), /requires async/)
  signer.destroy()
})

test('FrostSigner 2-of-3 signs and verifies', { skip: skipWasm }, async () => {
  const { generate_with_dealer, key_package_from_secret_share, verify_group_signature } =
    await import('@myecoria/frost-ed25519-blake2b-wasm')
  const dealer = generate_with_dealer(3, 2)
  const shares: SignerShare[] = [
    { index: 0, keyPackage: key_package_from_secret_share(dealer.share(0).secret_share), policy: 'auto' },
    { index: 1, keyPackage: key_package_from_secret_share(dealer.share(1).secret_share), policy: 'auto' },
    { index: 2, keyPackage: key_package_from_secret_share(dealer.share(2).secret_share), policy: 'approval-required' },
  ]

  const { FrostSigner } = await import('../src/frost.js')
  const signer = new FrostSigner({
    publicKeyPackage: dealer.public_key_package,
    shares,
    threshold: 2,
    dealerResult: dealer,
  })

  const card = {
    version: '1.0.0', name: 'frost-test', intent: 'FROST sign test', tags: [],
    cost: { latency: 'fast', sideEffects: false, reversible: true, riskTier: 'safe' as const, requiresConfirmation: false },
    idempotent: false, input: { type: 'object' }, output: { type: 'object' },
    examples: [], failureModes: [], provider: 'test',
  } as any

  const sigHex = await signer.signGlyph(card)
  assert.equal(sigHex.length, 128)
  assert.ok(/^[0-9a-f]{128}$/.test(sigHex))

  const msg = new TextEncoder().encode(canonicalHash(card))
  const valid = verify_group_signature(dealer.public_key_package, msg, Buffer.from(sigHex, 'hex'))
  assert.equal(valid, true)

  signer.destroy()
})

test('FROST WASM 2-of-3 sign+verify end-to-end', { skip: skipWasm }, async () => {
  const {
    generate_with_dealer,
    key_package_from_secret_share,
    verify_group_signature,
    round1_commit,
    round2_sign,
    create_signing_package,
    aggregate_signature,
    CommitmentList,
    SignatureShareList,
  } = await import('@myecoria/frost-ed25519-blake2b-wasm')

  const dealer = generate_with_dealer(3, 2)

  const kp0 = key_package_from_secret_share(dealer.share(0).secret_share)
  const kp1 = key_package_from_secret_share(dealer.share(1).secret_share)

  const r1_0 = round1_commit(kp0)
  const r1_1 = round1_commit(kp1)

  const commitments = new CommitmentList()
  commitments.push(r1_0.identifier, r1_0.commitments)
  commitments.push(r1_1.identifier, r1_1.commitments)

  const msg = new TextEncoder().encode('glyph frost test')
  const signingPkg = create_signing_package(commitments, msg)

  const s0 = round2_sign(signingPkg, r1_0.nonces, kp0)
  const s1 = round2_sign(signingPkg, r1_1.nonces, kp1)

  const sigShares = new SignatureShareList()
  sigShares.push(s0.identifier, s0.signature_share)
  sigShares.push(s1.identifier, s1.signature_share)

  const sig = aggregate_signature(signingPkg, sigShares, dealer.public_key_package)
  assert.equal(sig.length, 64)

  const valid = verify_group_signature(dealer.public_key_package, msg, sig)
  assert.equal(valid, true)

  ;[commitments, sigShares, r1_0, r1_1, s0, s1, dealer].forEach((o) => o.free())
})
