import { FilePendingAuditQueue } from '@glyphp/client'
import type { CardDiff } from '@glyphp/types'

export interface AuditResult {
  ok: boolean
  report: string
}

/**
 * Default location of the persisted pending-audit queue. Override per command
 * with --file. Kept under the home directory so the CLI behaves the same from
 * any working directory.
 */
const DEFAULT_QUEUE_FILE = `${process.env.HOME || process.env.USERPROFILE || '.'}/.glyph/pending-audits.json`

/** Renders one CardDiff as indented field-change lines. */
function renderDiff(diff: CardDiff): string[] {
  if (!diff.changed) return ['    (no field changes)']
  const width = Math.max(...diff.changes.map((c) => c.field.length))
  return diff.changes.map((c) => {
    const tag = c.severity === 'breaking' ? 'BREAKING' : 'review  '
    return `    ${c.field.padEnd(width)}  ${tag}`
  })
}

/**
 * Lists the tool updates an agent has parked for audit. Read-only: it inspects
 * the persisted queue and shows each entry's diff so a human can review and
 * approve (with `glyph approve`) or leave it to the autonomous runner. `ok` is
 * false when any parked update carries a breaking change awaiting review.
 */
export async function runAuditList(options?: { file?: string }): Promise<AuditResult> {
  const queue = new FilePendingAuditQueue(options?.file ?? DEFAULT_QUEUE_FILE)
  const entries = await queue.list()
  if (entries.length === 0) {
    return { ok: true, report: 'No pending audits. Tool updates are all reviewed.' }
  }

  let anyBreaking = false
  const lines = ['Pending tool updates awaiting audit:']
  for (const entry of entries) {
    const breaking = entry.diff.requiresApproval
    if (breaking) anyBreaking = true
    const verdict = breaking ? 'BREAKING — needs review' : 'review-only'
    lines.push(`  ${entry.toolName.padEnd(28)} ${verdict}`)
    lines.push(`    new id:    ${entry.newCard.id}`)
    lines.push(`    detected:  ${entry.detectedAt}`)
    if (entry.diff.keyChanged) lines.push('    keyChanged: yes')
    lines.push(...renderDiff(entry.diff))
  }
  lines.push('')
  lines.push('Review a card and run `glyph approve <card>` to promote it.')
  return { ok: !anyBreaking, report: lines.join('\n') }
}
