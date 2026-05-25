import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ImportResult } from './types.js'

/**
 * Writes IMPORT_REPORT.md summarising imported vs skipped MCPs and listing
 * any cards that the heuristic tagged as danger/caution for review.
 */
export async function emitReport(
  outDir: string,
  result: ImportResult
): Promise<string> {
  const lines: string[] = [
    `# Glyph MCP import report — ${new Date().toISOString()}`,
    '',
    `## Imported (${result.imported.length})`,
    '',
  ]
  if (result.imported.length === 0) {
    lines.push('(none)')
  } else {
    for (const s of result.imported) {
      lines.push(
        `- \`${s.config.name}\` (${s.config.source}) → \`${s.outputDir}/\`, port ${s.port}, ${s.toolCount} tools`
      )
    }
  }
  lines.push('', `## Skipped (${result.skipped.length})`, '')
  if (result.skipped.length === 0) {
    lines.push('(none)')
  } else {
    for (const s of result.skipped) {
      lines.push(`- \`${s.config.name}\` (${s.config.source}): ${s.reason}`)
    }
  }

  const review = result.imported
    .flatMap((s) =>
      s.cards
        .filter((c) => c.riskTier !== 'safe')
        .map((c) => ({ server: s.config.name, ...c }))
    )
  lines.push('', `## ⚠ Review before production (${review.length} cards)`, '')
  if (review.length === 0) {
    lines.push('All imported cards are tagged `safe` by the heuristic.')
  } else {
    lines.push(
      'The MCP adapter infers cost/risk from tool names and MCP annotations.',
      'Audit the following before letting agents call them:',
      ''
    )
    for (const c of review) {
      lines.push(
        `- \`${c.server}.${c.name}\` → **${c.riskTier}**${c.requiresConfirmation ? ' + requires confirmation' : ''}`
      )
    }
  }

  const path = join(outDir, 'IMPORT_REPORT.md')
  await writeFile(path, lines.join('\n') + '\n', 'utf8')
  return path
}
