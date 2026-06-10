#!/usr/bin/env node
import { createHash } from 'node:crypto'
/**
 * Generates canonical test vectors used by every SDK (TypeScript, Python,
 * Go, …) to verify that they implement the protocol identically.
 *
 * Outputs:
 *   spec/canonical/canonicalize-vectors.json — JSON value → canonical UTF-8 bytes
 *   spec/canonical/hashing-vectors.json       — JSON value → SHA-256 hex
 *   spec/canonical/signature-vectors.json     — message + key → ed25519 signature
 *   spec/canonical/sanitize-vectors.json      — input string → sanitized output + report
 *
 * Re-run with `pnpm exec node scripts/generate-vectors.mjs` whenever the
 * canonical form, hashing, signature, or sanitization changes — the SDKs'
 * test suites will fail loudly if anyone forgets.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { canonicalHash, canonicalize, sanitize } from '@glyphp/core'
import * as ed from '@noble/ed25519'

// Sync sha512 needed for synchronous ed25519 usage (@noble/ed25519 v3 API).
ed.hashes.sha512 = (msg) => Uint8Array.from(createHash('sha512').update(msg).digest())

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(repoRoot, 'spec/canonical')
mkdirSync(outDir, { recursive: true })

// ---------- 1. canonicalize ------------------------------------------------

const canonicalCases = [
  { name: 'primitive-null', input: null },
  { name: 'primitive-true', input: true },
  { name: 'primitive-number', input: 42 },
  { name: 'primitive-string', input: 'hello' },
  { name: 'empty-object', input: {} },
  { name: 'empty-array', input: [] },
  { name: 'flat-object-sorted', input: { b: 1, a: 2, c: 3 } },
  {
    name: 'nested-object-sorted',
    input: { x: { z: 1, y: 2 }, a: [{ b: 1, a: 2 }] },
  },
  { name: 'unicode-string', input: { msg: 'héllo wörld 🚀' } },
  { name: 'mixed-array', input: [1, 'two', true, null, { k: 'v' }] },
]

// JCS (RFC 8785) edge cases, expressed as RAW JSON text so each SDK exercises
// its own parser + serializer (spec/protocol.md §8.1). Written via JS values
// they would normalize before the SDK under test ever saw them — e.g. `1.0`
// already parses to `1` here.
const rawJsonCases = [
  { name: 'jcs-integral-float', inputJson: '1.0' },
  { name: 'jcs-negative-zero', inputJson: '-0.0' },
  { name: 'jcs-exponent-large', inputJson: '1e21' },
  { name: 'jcs-exponent-small', inputJson: '1e-7' },
  { name: 'jcs-exponent-zero-padded', inputJson: '1e-07' },
  { name: 'jcs-decimal-boundary', inputJson: '0.000001' },
  { name: 'jcs-shortest-roundtrip', inputJson: '0.1' },
  { name: 'jcs-long-float', inputJson: '123456789.123456789' },
  { name: 'jcs-max-double', inputJson: '1.7976931348623157e+308' },
  { name: 'jcs-min-subnormal', inputJson: '5e-324' },
  { name: 'jcs-max-safe-integer', inputJson: '9007199254740991' },
  { name: 'jcs-beyond-safe-integer', inputJson: '9007199254740993' },
  { name: 'jcs-nested-numbers', inputJson: '{"a":1.0,"b":[1e-07,-0.0],"c":1e21}' },
  // U+10000 (surrogate pair D800 DC00) sorts BEFORE U+FF61 in UTF-16 code
  // units, but AFTER it in code points/UTF-8 bytes — the JCS ordering test.
  { name: 'jcs-utf16-key-order', inputJson: '{"｡":1,"\u{10000}":2}' },
]

const canonicalVectors = [
  ...canonicalCases.map(({ name, input }) => ({
    name,
    input,
    canonical: JSON.stringify(canonicalize(input)),
  })),
  ...rawJsonCases.map(({ name, inputJson }) => ({
    name,
    inputJson,
    canonical: JSON.stringify(canonicalize(JSON.parse(inputJson))),
  })),
]
writeFileSync(
  join(outDir, 'canonicalize-vectors.json'),
  `${JSON.stringify({ generated: new Date().toISOString(), cases: canonicalVectors }, null, 2)}\n`,
)

// ---------- 2. hashing -----------------------------------------------------

const hashingVectors = [
  ...canonicalCases.map(({ name, input }) => ({
    name,
    input,
    sha256: canonicalHash(input),
  })),
  ...rawJsonCases.map(({ name, inputJson }) => ({
    name,
    inputJson,
    sha256: canonicalHash(JSON.parse(inputJson)),
  })),
]
writeFileSync(
  join(outDir, 'hashing-vectors.json'),
  `${JSON.stringify({ generated: new Date().toISOString(), cases: hashingVectors }, null, 2)}\n`,
)

// ---------- 3. signatures --------------------------------------------------
// ed25519 is deterministic, so a fixed private key + fixed message produces
// the same signature every time. The keys here are *test fixtures only* —
// never used for real signing.

const fixedKeys = [
  '4c8b7c0d2e7d4f6a8b9c0d1e2f3a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c',
  '0000000000000000000000000000000000000000000000000000000000000001',
  'aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899',
]

const signatureCases = [
  { name: 'empty', message: '' },
  { name: 'simple', message: 'hello, glyph' },
  { name: 'canonical-object', message: canonicalHash({ a: 1, b: 'two' }) },
]

const signatureVectors = []
for (const privHex of fixedKeys) {
  const privBytes = new Uint8Array(Buffer.from(privHex, 'hex'))
  const pubBytes = ed.getPublicKey(privBytes)
  const pubHex = Buffer.from(pubBytes).toString('hex')
  for (const { name, message } of signatureCases) {
    const msgBytes = new TextEncoder().encode(message)
    const sigBytes = ed.sign(msgBytes, privBytes)
    signatureVectors.push({
      name: `${name}-${pubHex.slice(0, 8)}`,
      privateKey: privHex,
      publicKey: pubHex,
      message,
      signature: Buffer.from(sigBytes).toString('hex'),
    })
  }
}
writeFileSync(
  join(outDir, 'signature-vectors.json'),
  `${JSON.stringify({ generated: new Date().toISOString(), cases: signatureVectors }, null, 2)}\n`,
)

// ---------- 4. sanitize ----------------------------------------------------

const sanitizeCases = [
  { name: 'clean-string', input: 'hello world' },
  { name: 'zero-width-removed', input: 'hi​bye' },
  { name: 'tag-block-removed', input: 'tag0here' },
  { name: 'bidi-override', input: 'norm‮olam' },
  { name: 'nfkc-fold', input: 'ﬁle' }, // U+FB01 ligature → "file"
  { name: 'nested-object', input: { msg: 'pure​text', n: 5 } },
  {
    name: 'array-with-control',
    input: ['onetwo', { k: 'three​' }],
  },
  {
    // Object keys containing JSON-pointer special characters: the report
    // paths must escape them per RFC 6901 (`~` → `~0`, `/` → `~1`).
    name: 'escaped-object-keys',
    input: { 'a/b': 'x​y', 'a~b': 'z​w' },
  },
]

const sanitizeVectors = sanitizeCases.map(({ name, input }) => {
  const { value, report } = sanitize(input)
  return { name, input, output: value, report }
})
writeFileSync(
  join(outDir, 'sanitize-vectors.json'),
  `${JSON.stringify({ generated: new Date().toISOString(), cases: sanitizeVectors }, null, 2)}\n`,
)

console.log(`Wrote canonical vectors to ${outDir}`)
console.log(`  canonicalize-vectors.json (${canonicalVectors.length} cases)`)
console.log(`  hashing-vectors.json      (${hashingVectors.length} cases)`)
console.log(`  signature-vectors.json    (${signatureVectors.length} cases)`)
console.log(`  sanitize-vectors.json     (${sanitizeVectors.length} cases)`)
