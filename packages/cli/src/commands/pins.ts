import { FilePinStore, GlyphClient } from '@glyphp/client'
import { loadCard } from './verify.js'

export interface PinsResult {
  ok: boolean
  report: string
}

/**
 * Default pin file location. A user can override it per command with --file.
 * Kept under the home directory so a user-level CLI behaves consistently
 * whether invoked from a project root or anywhere else.
 */
const DEFAULT_PIN_FILE = `${process.env.HOME || process.env.USERPROFILE || '.'}/.glyph/pins.json`

function storeFor(file?: string): FilePinStore {
  return new FilePinStore(file ?? DEFAULT_PIN_FILE)
}

/** Lists every pin in the store, with status (approved/revoked) and tool id. */
export async function runPinsList(options?: { file?: string }): Promise<PinsResult> {
  const store = storeFor(options?.file)
  const pins = await store.list()
  if (pins.length === 0) {
    return { ok: true, report: 'No pins. Use `glyph approve` to record one.' }
  }
  const lines = ['Pinned tools:']
  for (const pin of pins) {
    const status = pin.revokedAt ? 'revoked' : 'approved'
    const when = pin.revokedAt ?? pin.approvedAt
    const why = pin.revokeReason ? ` — ${pin.revokeReason}` : ''
    lines.push(`  ${pin.toolName.padEnd(28)} ${status.padEnd(9)} ${when}${why}`)
    lines.push(`    id:        ${pin.card.id}`)
    lines.push(`    publicKey: ${pin.card.publicKey}`)
  }
  return { ok: true, report: lines.join('\n') }
}

/**
 * Approves a card from a file or URL: verifies its signature, then writes a
 * pin. Pass `--reinstate` to clear an existing revocation deliberately.
 */
export async function runPinsApprove(
  source: string,
  options?: { file?: string; reinstate?: boolean },
): Promise<PinsResult> {
  if (!source) {
    return {
      ok: false,
      report: 'approve requires a card source (file or URL)',
    }
  }
  const card = await loadCard(source)
  const store = storeFor(options?.file)
  // We construct a client only to reuse its verification + revoke handling.
  // The baseUrl is unused by approveCard.
  const client = new GlyphClient({ baseUrl: 'http://unused', pins: store })
  const pin = await client.approveCard(card, {
    reinstate: options?.reinstate,
  })
  return {
    ok: true,
    report: [
      `Approved "${pin.toolName}"`,
      `  id:        ${pin.card.id}`,
      `  publicKey: ${pin.card.publicKey}`,
      `  saved to:  ${options?.file ?? DEFAULT_PIN_FILE}`,
    ].join('\n'),
  }
}

/**
 * Revokes a tool: future call()s refuse it until a deliberate reinstate.
 * Throws if the tool has no pin — there is nothing to revoke.
 */
export async function runPinsRevoke(
  toolName: string,
  options?: { file?: string; reason?: string },
): Promise<PinsResult> {
  if (!toolName) {
    return { ok: false, report: 'revoke requires a tool name' }
  }
  const store = storeFor(options?.file)
  const client = new GlyphClient({ baseUrl: 'http://unused', pins: store })
  const pin = await client.revokeTool(toolName, options?.reason)
  return {
    ok: true,
    report: [
      `Revoked "${pin.toolName}"`,
      pin.revokeReason ? `  reason: ${pin.revokeReason}` : null,
      `  reinstate with: glyph approve <card> --reinstate`,
    ]
      .filter(Boolean)
      .join('\n'),
  }
}
