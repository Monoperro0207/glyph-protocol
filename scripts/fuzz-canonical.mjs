#!/usr/bin/env node
/**
 * Differential canonicalization fuzzer (spec/protocol.md §8.1).
 *
 * Generates random JSON values — biased toward the number edge cases where
 * JCS / RFC 8785 implementations diverge — serializes each as raw JSON text,
 * and asks every SDK (TypeScript reference, Python, Go) to parse and
 * canonical-hash the same text. Any mismatch is an interoperability break in
 * ids/signatures and fails loudly with the offending case and seed.
 *
 * Deterministic for a given seed. Override with GLYPH_FUZZ_SEED=<int> to
 * reproduce a failure; case count with GLYPH_FUZZ_CASES=<int>.
 *
 * Runners that are not installed (no Python .venv, no Go toolchain) are
 * reported as SKIPPED — same semantics as verify:full's optional steps.
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { canonicalHash } from '@glyphp/core'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const seed = Number(process.env.GLYPH_FUZZ_SEED ?? 20260609)
const caseCount = Number(process.env.GLYPH_FUZZ_CASES ?? 300)

// ---------------------------------------------------------------------------
// Deterministic PRNG (mulberry32) — reproducible cases from the seed.
// ---------------------------------------------------------------------------
function mulberry32(a) {
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rand = mulberry32(seed)
const pick = (arr) => arr[Math.floor(rand() * arr.length)]

// Random double from random bits — covers subnormals, extreme exponents,
// negative zero. Re-rolled when non-finite (JSON cannot carry NaN/Infinity)
// or when integral with |v| > 2^53 - 1 in full-digit range (ECMAScript prints
// full digits below 1e21; other languages parse them as big integers, which
// the spec tells producers to avoid).
function randomDouble() {
  const buf = new DataView(new ArrayBuffer(8))
  for (;;) {
    buf.setUint32(0, Math.floor(rand() * 2 ** 32))
    buf.setUint32(4, Math.floor(rand() * 2 ** 32))
    const v = buf.getFloat64(0)
    if (!Number.isFinite(v)) continue
    if (Number.isInteger(v) && Math.abs(v) > Number.MAX_SAFE_INTEGER && Math.abs(v) < 1e21) {
      continue
    }
    return v
  }
}

const trickyNumbers = [
  0, -0, 1, -1, 0.1, 1.5, 1e-6, 1e-7, 1e21, 1e-300, 5e-324, 1.7976931348623157e308,
  9007199254740991, -9007199254740991, 123456789.123456789, 2.5e-10, 3.14159265358979,
]
const strings = ['', 'a', 'héllo 🚀', 'line\nbreak', 'quote"back\\slash', 'ctrl', '｡', '\u{10000}']
const keys = ['a', 'b', 'z', '0', 'é', '｡', '\u{10000}', 'nested', 'k k', '~/']

function randomValue(depth) {
  const r = rand()
  if (depth <= 0 || r < 0.35) {
    const kind = rand()
    if (kind < 0.45) return rand() < 0.5 ? pick(trickyNumbers) : randomDouble()
    if (kind < 0.7) return pick(strings)
    if (kind < 0.8) return rand() < 0.5
    return null
  }
  if (r < 0.65) {
    const n = Math.floor(rand() * 4)
    return Array.from({ length: n }, () => randomValue(depth - 1))
  }
  const obj = {}
  const n = Math.floor(rand() * 4)
  for (let i = 0; i < n; i++) obj[pick(keys)] = randomValue(depth - 1)
  return obj
}

const cases = Array.from({ length: caseCount }, () => JSON.stringify(randomValue(3)))
const expected = cases.map((raw) => canonicalHash(JSON.parse(raw)))

// ---------------------------------------------------------------------------
// Runners
// ---------------------------------------------------------------------------
const pythonScript = `
import json, sys
from glyph_protocol import canonical_hash
for raw in json.load(sys.stdin):
    print(canonical_hash(json.loads(raw)))
`

const runners = [
  {
    name: 'python',
    available: () => existsSync(join(repoRoot, 'sdks/python/.venv/bin/python')),
    run: (input) =>
      spawnSync(join(repoRoot, 'sdks/python/.venv/bin/python'), ['-c', pythonScript], {
        input,
        encoding: 'utf8',
        cwd: join(repoRoot, 'sdks/python'),
      }),
  },
  {
    name: 'go',
    available: () => spawnSync('go', ['version'], { encoding: 'utf8' }).status === 0,
    run: (input) =>
      spawnSync('go', ['run', './cmd/canonhash'], {
        input,
        encoding: 'utf8',
        cwd: join(repoRoot, 'sdks/go/glyphprotocol'),
      }),
  },
]

const payload = JSON.stringify(cases)
let failed = false

for (const runner of runners) {
  if (!runner.available()) {
    console.log(`fuzz-canonical: SKIPPED ${runner.name} — runtime not found (not full coverage)`)
    continue
  }
  const result = runner.run(payload)
  if (result.status !== 0) {
    console.error(`fuzz-canonical: ${runner.name} runner failed:\n${result.stderr}`)
    failed = true
    continue
  }
  const got = result.stdout.trim().split('\n')
  if (got.length !== expected.length) {
    console.error(
      `fuzz-canonical: ${runner.name} returned ${got.length} hashes, expected ${expected.length}`,
    )
    failed = true
    continue
  }
  let mismatches = 0
  for (let i = 0; i < expected.length; i++) {
    if (got[i] !== expected[i]) {
      mismatches++
      if (mismatches <= 5) {
        console.error(
          `fuzz-canonical: ${runner.name} MISMATCH (seed ${seed}, case ${i}):\n  input    ${cases[i]}\n  expected ${expected[i]}\n  got      ${got[i]}`,
        )
      }
    }
  }
  if (mismatches > 0) {
    console.error(`fuzz-canonical: ${runner.name} — ${mismatches}/${expected.length} mismatches`)
    failed = true
  } else {
    console.log(`fuzz-canonical: ${runner.name} OK — ${expected.length}/${expected.length} hashes match (seed ${seed})`)
  }
}

if (failed) process.exit(1)
