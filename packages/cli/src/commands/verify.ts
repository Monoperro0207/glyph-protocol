import { readFile } from 'node:fs/promises'
import { computeGlyphId, verifyGlyph } from '@glyphp/core'
import type { GlyphCard } from '@glyphp/types'

export interface VerifyResult {
  ok: boolean
  report: string
}

/**
 * Loads a glyph card from a file path or an `http(s)` URL and checks its
 * content hash and signature.
 */
export async function runVerify(source: string): Promise<VerifyResult> {
  const card = await loadCard(source)

  const idOk = computeGlyphId(card) === card.id
  const sigOk = verifyGlyph(card)
  const ok = idOk && sigOk

  const report = [
    `Verifying ${card.name || '(unnamed card)'} — ${source}`,
    `  content hash: ${idOk ? 'OK (id matches the canonical content)' : 'FAIL (id does not match the content)'}`,
    `  signature:    ${sigOk ? 'OK (verifies against the embedded public key)' : 'FAIL (missing or invalid)'}`,
    ok ? 'PASS' : 'FAIL',
  ].join('\n')

  return { ok, report }
}

async function loadCard(source: string): Promise<GlyphCard> {
  let raw: string
  if (/^https?:\/\//.test(source)) {
    const res = await fetch(source)
    if (!res.ok) throw new Error(`could not fetch ${source}: HTTP ${res.status}`)
    raw = await res.text()
  } else {
    raw = await readFile(source, 'utf8')
  }
  try {
    return JSON.parse(raw) as GlyphCard
  } catch {
    throw new Error(`${source} is not valid JSON`)
  }
}
