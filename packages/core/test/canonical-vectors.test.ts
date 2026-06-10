import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { canonicalHash, canonicalize } from '../src/index.js'

// The TS SDK is the reference implementation, but it must still be *checked*
// against the shared vectors — especially the raw-JSON (`inputJson`) cases
// that lock the JCS / RFC 8785 number and key-order behavior the spec
// mandates (spec/protocol.md §8.1) for every SDK, this one included.

const vectorsDir = join(fileURLToPath(import.meta.url), '../../../../spec/canonical')

type VectorCase = { name: string; input?: unknown; inputJson?: string }

function loadCases(name: string): Array<VectorCase & { canonical?: string; sha256?: string }> {
  return JSON.parse(readFileSync(join(vectorsDir, name), 'utf8')).cases
}

const caseInput = (c: VectorCase): unknown =>
  'inputJson' in c && c.inputJson !== undefined ? JSON.parse(c.inputJson) : c.input

test('canonicalize matches the shared reference vectors', () => {
  for (const c of loadCases('canonicalize-vectors.json')) {
    assert.equal(JSON.stringify(canonicalize(caseInput(c))), c.canonical, c.name)
  }
})

test('canonicalHash matches the shared reference vectors', () => {
  for (const c of loadCases('hashing-vectors.json')) {
    assert.equal(canonicalHash(caseInput(c)), c.sha256, c.name)
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
