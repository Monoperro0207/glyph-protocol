import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { test } from 'node:test'

// The package bundles a copy of spec/schemas/ so it can ship the schemas.
// This guards the copy against drifting from the canonical source.
const bundledDir = new URL('../schemas/', import.meta.url)
const canonicalDir = new URL('../../../spec/schemas/', import.meta.url)

test('bundled schemas are byte-identical to spec/schemas', () => {
  const files = readdirSync(bundledDir).filter((f) => f.endsWith('.json'))
  assert.ok(files.length >= 9, 'expected the full set of schemas')
  for (const file of files) {
    const bundled = readFileSync(new URL(file, bundledDir), 'utf8')
    const canonical = readFileSync(new URL(file, canonicalDir), 'utf8')
    assert.equal(bundled, canonical, `${file} has drifted from spec/schemas/`)
  }
})
