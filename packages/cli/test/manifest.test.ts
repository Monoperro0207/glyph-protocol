import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { generateKeyPair, signManifest } from '@glyphp/core'
import { runManifestVerify } from '../src/commands/manifest.js'

function makeValidManifest() {
  const kp = generateKeyPair()
  const unsigned = {
    manifestVersion: '1.0',
    toolName: 'test.tool',
    previousCardId: 'aa'.repeat(32),
    newCardId: 'bb'.repeat(32),
    reason: 'Routine rotation',
    breaking: false,
    securityImpact: 'none' as const,
    issuedAt: new Date().toISOString(),
    serverPublicKey: kp.publicKey,
  }
  const signature = signManifest(unsigned as any, kp.privateKey)
  return { manifest: { ...unsigned, signature }, kp }
}

describe('runManifestVerify', () => {
  it('rejects empty source', async () => {
    const result = await runManifestVerify('')
    assert.equal(result.ok, false)
    assert.match(result.report, /file path or URL/)
  })

  it('loads and verifies manifest from file', async () => {
    const { manifest } = makeValidManifest()
    const dir = mkdtempSync(join(tmpdir(), 'glyph-manifest-'))
    try {
      const path = join(dir, 'manifest.json')
      writeFileSync(path, JSON.stringify(manifest), 'utf8')
      const result = await runManifestVerify(path)
      assert.equal(result.ok, true)
      assert.match(result.report, /PASS/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('rejects invalid JSON file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'glyph-manifest-'))
    try {
      const path = join(dir, 'bad.json')
      writeFileSync(path, 'not json', 'utf8')
      await assert.rejects(() => runManifestVerify(path), /not valid JSON/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('rejects tampered manifest signature', async () => {
    const { manifest } = makeValidManifest()
    const tampered = { ...manifest, reason: 'HACKED' }
    const dir = mkdtempSync(join(tmpdir(), 'glyph-manifest-'))
    try {
      const path = join(dir, 'tampered.json')
      writeFileSync(path, JSON.stringify(tampered), 'utf8')
      const result = await runManifestVerify(path)
      assert.equal(result.ok, false)
      assert.match(result.report, /FAIL/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('handles file not found', async () => {
    await assert.rejects(() => runManifestVerify('/tmp/nonexistent-glyph-manifest-12345.json'))
  })
})
