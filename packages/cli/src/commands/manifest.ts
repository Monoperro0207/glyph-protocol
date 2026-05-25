import { readFile } from 'node:fs/promises'
import { verifyManifest } from '@glyphp/core'
import type { UpdateManifest } from '@glyphp/types'

export interface ManifestResult {
  ok: boolean
  report: string
}

/**
 * Loads an UpdateManifest from a file path or http(s) URL and verifies its
 * signature against the embedded `serverPublicKey`. Note: this only proves
 * the manifest is internally consistent. A consumer that already pinned the
 * tool MUST additionally check the manifest is signed by the *pinned* key —
 * the client does that automatically via `getManifest()`.
 */
export async function runManifestVerify(source: string): Promise<ManifestResult> {
  if (!source) {
    return {
      ok: false,
      report: 'manifest verify requires a file path or URL',
    }
  }
  const manifest = await loadManifest(source)
  const sigOk = verifyManifest(manifest)
  const lines = [
    `Verifying update manifest — ${source}`,
    `  tool:       ${manifest.toolName}`,
    `  ${manifest.previousCardId} -> ${manifest.newCardId}`,
    `  reason:     ${manifest.reason}`,
    `  breaking:   ${manifest.breaking}`,
    `  security:   ${manifest.securityImpact}`,
    `  issued at:  ${manifest.issuedAt}`,
    `  signed by:  ${manifest.serverPublicKey}`,
    `  signature:  ${sigOk ? 'OK' : 'FAIL (does not verify against embedded key)'}`,
    sigOk ? 'PASS' : 'FAIL',
    sigOk
      ? '  note: this verifies internal consistency only. A pinned consumer also requires the manifest to be signed by the pinned key.'
      : '',
  ].filter(Boolean)
  return { ok: sigOk, report: lines.join('\n') }
}

async function loadManifest(source: string): Promise<UpdateManifest> {
  let raw: string
  if (/^https?:\/\//.test(source)) {
    const res = await fetch(source)
    if (!res.ok) throw new Error(`could not fetch ${source}: HTTP ${res.status}`)
    raw = await res.text()
  } else {
    raw = await readFile(source, 'utf8')
  }
  try {
    return JSON.parse(raw) as UpdateManifest
  } catch {
    throw new Error(`${source} is not valid JSON`)
  }
}
