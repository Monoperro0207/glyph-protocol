import { diffCards } from '@glyphp/core'
import type { CardDiff, GlyphCard } from '@glyphp/types'
import { loadCard } from './verify.js'

export interface DiffResult {
  ok: boolean
  report: string
}

/**
 * Loads two glyph cards (each a file path or an `http(s)` URL) and classifies
 * how they differ. `ok` is false when the diff carries a breaking change, so
 * `glyph diff-card` can gate CI on an un-reviewed tool update.
 */
export async function runDiffCard(oldSource: string, newSource: string): Promise<DiffResult> {
  const [approved, next] = await Promise.all([loadCard(oldSource), loadCard(newSource)])
  const diff = diffCards(approved, next)
  return { ok: !diff.requiresApproval, report: formatDiff(approved, next, diff) }
}

/** Renders a CardDiff as a human-readable report. */
export function formatDiff(approved: GlyphCard, next: GlyphCard, diff: CardDiff): string {
  const lines = [
    `Comparing ${approved.name || '(unnamed card)'}`,
    `  old id: ${approved.id}`,
    `  new id: ${next.id}`,
    '',
  ]

  if (!diff.changed) {
    lines.push('  no differences — the cards are identical', 'PASS')
    return lines.join('\n')
  }

  const width = Math.max(...diff.changes.map((c) => c.field.length))
  for (const c of diff.changes) {
    const tag = c.severity === 'breaking' ? 'BREAKING' : 'review  '
    lines.push(`  ${c.field.padEnd(width)}  ${tag}  ${fmt(c.before)} -> ${fmt(c.after)}`)
  }

  lines.push(
    '',
    `  id changed:   ${diff.idChanged ? 'yes' : 'no'}`,
    `  key changed:  ${diff.keyChanged ? 'yes' : 'no'}`,
    diff.requiresApproval
      ? 'REQUIRES APPROVAL — breaking changes present, re-approval needed'
      : 'REVIEW — descriptive changes only, no breaking change',
  )
  return lines.join('\n')
}

/** Compact one-line rendering of a field value for the report. */
function fmt(value: unknown): string {
  if (value === undefined) return '(absent)'
  const s = typeof value === 'string' ? value : JSON.stringify(value)
  return s.length > 60 ? `${s.slice(0, 57)}...` : s
}
