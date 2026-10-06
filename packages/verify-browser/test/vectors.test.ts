import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { canonicalHash, canonicalize, fromHex } from '../src/canonical.js'
import { ed } from '../src/ed-setup.js'

// This package is an independent reimplementation, so the shared vectors are
// its conformance contract — the same role they play for the Python and Go
// SDKs. The raw-JSON (`inputJson`) cases lock the JCS / RFC 8785 number and
// key-order behavior that spec/protocol.md §8.1 mandates of every SDK.

const here = fileURLToPath(import.meta.url)
const vectorsDir = join(here, '../../../../spec/canonical')
const srcDir = join(here, '../../src')

type VectorCase = { name: string; input?: unknown; inputJson?: string }

function loadCases(name: string): Array<VectorCase & { canonical?: string; sha256?: string }> {
  return JSON.parse(readFileSync(join(vectorsDir, name), 'utf8')).cases
}

const caseInput = (c: VectorCase): unknown =>
  'inputJson' in c && c.inputJson !== undefined ? JSON.parse(c.inputJson) : c.input

test('canonicalize matches the shared reference vectors', () => {
  const cases = loadCases('canonicalize-vectors.json')
  assert.ok(cases.length > 0, 'vector file is empty')
  for (const c of cases) {
    assert.equal(JSON.stringify(canonicalize(caseInput(c))), c.canonical, c.name)
  }
})

test('canonicalHash matches the shared reference vectors', () => {
  const cases = loadCases('hashing-vectors.json')
  assert.ok(cases.length > 0, 'vector file is empty')
  for (const c of cases) {
    assert.equal(canonicalHash(caseInput(c)), c.sha256, c.name)
  }
})

test('ed25519 verification matches the shared signature vectors', () => {
  type SigCase = {
    name: string
    privateKey: string
    publicKey: string
    message: string
    signature: string
  }
  const cases: SigCase[] = JSON.parse(
    readFileSync(join(vectorsDir, 'signature-vectors.json'), 'utf8'),
  ).cases
  assert.ok(cases.length > 0, 'vector file is empty')

  for (const c of cases) {
    const msg = new TextEncoder().encode(c.message)
    assert.equal(
      ed.verify(fromHex(c.signature), msg, fromHex(c.publicKey)),
      true,
      `${c.name}: signature should verify`,
    )
    // ed25519 is deterministic — re-signing must reproduce the vector byte for byte.
    assert.equal(
      ed.etc.bytesToHex(ed.sign(msg, fromHex(c.privateKey))),
      c.signature,
      `${c.name}: re-signing should be deterministic`,
    )
  }

  // A signature must not verify under any other key in the corpus. Without
  // this, a verifier that ignored the key argument would still pass above.
  const keys = [...new Set(cases.map((c) => c.publicKey))]
  assert.ok(keys.length > 1, 'need multiple keypairs to test cross-key rejection')
  for (const c of cases) {
    const msg = new TextEncoder().encode(c.message)
    for (const other of keys.filter((k) => k !== c.publicKey)) {
      assert.equal(
        ed.verify(fromHex(c.signature), msg, fromHex(other)),
        false,
        `${c.name}: must not verify under a foreign key`,
      )
    }
  }
})

// Lock the JCS number rules directly, independent of the vector file, so a
// regression in vector generation cannot mask one in serialization.
test('number serialization follows RFC 8785 (ECMAScript JSON.stringify)', () => {
  const expectations: Array<[string, string]> = [
    ['1.0', '1'],
    ['-0.0', '0'],
    ['1e21', '1e+21'],
    ['1e-7', '1e-7'],
    ['1e-07', '1e-7'],
    ['0.000001', '0.000001'],
    ['9007199254740993', '9007199254740992'],
  ]
  for (const [raw, expected] of expectations) {
    assert.equal(JSON.stringify(canonicalize(JSON.parse(raw))), expected, raw)
  }
})

test('object keys sort by UTF-16 code units, not code points', () => {
  // U+10000 (surrogate pair D800 DC00) < U+FF61 in UTF-16 code units.
  const input = JSON.parse('{"｡":1,"\u{10000}":2}')
  assert.equal(JSON.stringify(canonicalize(input)), '{"\u{10000}":2,"｡":1}')
})

// The whole point of this package is that it runs in a browser. A single
// stray `node:` import or `Buffer` reference would silently undo that, and the
// failure would only surface in someone else's bundler. Two lines, permanent.
test('source contains no Node-only APIs', () => {
  const offenders: string[] = []
  for (const file of readdirSync(srcDir).filter((f) => f.endsWith('.ts'))) {
    const body = readFileSync(join(srcDir, file), 'utf8')
    // Strip block/line comments so prose about `node:` does not trip the scan.
    const code = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    if (/\bnode:/.test(code)) offenders.push(`${file}: node: import`)
    if (/\bBuffer\b/.test(code)) offenders.push(`${file}: Buffer`)
    if (/\bprocess\./.test(code)) offenders.push(`${file}: process.`)
  }
  assert.deepEqual(offenders, [], `browser-unsafe APIs found: ${offenders.join(', ')}`)
})
