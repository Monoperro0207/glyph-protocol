#!/usr/bin/env node
import { writeFileSync } from 'node:fs'
import {
  runConformance,
  formatReport,
  formatReportMarkdown,
  ALL_LEVELS,
} from './conformance.js'
import type { ConformanceLevel, FixtureGlyphs } from './types.js'

interface Args {
  baseUrl?: string
  levels?: ConformanceLevel[]
  output?: string
  markdown?: string
  authToken?: string
  fixtures: FixtureGlyphs
  help: boolean
}

function parseArgs(argv: string[]): Args {
  const out: Args = { fixtures: {}, help: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') out.help = true
    else if (arg === '--level' || arg === '--levels') {
      const value = argv[++i] ?? ''
      out.levels = value === 'all'
        ? Array.from(ALL_LEVELS)
        : value
            .split(',')
            .map((s) => s.trim() as ConformanceLevel)
            .filter((s) => (ALL_LEVELS as readonly string[]).includes(s))
    } else if (arg === '--output') out.output = argv[++i]
    else if (arg === '--markdown') out.markdown = argv[++i]
    else if (arg === '--auth-token') out.authToken = argv[++i]
    else if (arg === '--fixture-echo') out.fixtures.echo = argv[++i]
    else if (arg === '--fixture-requires-confirmation') {
      out.fixtures.requiresConfirmation = argv[++i]
    } else if (arg === '--fixture-slow') out.fixtures.slow = argv[++i]
    else if (arg === '--fixture-invalid-output') {
      out.fixtures.invalidOutput = argv[++i]
    } else if (!arg.startsWith('-') && !out.baseUrl) {
      out.baseUrl = arg
    }
  }
  return out
}

const args = parseArgs(process.argv.slice(2))

if (args.help || !args.baseUrl) {
  console.error(
    [
      'usage: glyph-conformance <baseUrl> [options]',
      '',
      'options:',
      '  --level <list|all>           comma-separated subset of:',
      '                                 discovery, execution, security, governance',
      '  --output <file>              write report JSON',
      '  --markdown <file>            write report as markdown',
      '  --auth-token <token>         bearer token for protected servers',
      '  --fixture-echo <name>        a safe echo glyph (execution level)',
      '  --fixture-requires-confirmation <name>',
      '                               a glyph that requires confirmation (security)',
      '  --fixture-slow <name>        a glyph whose handler exceeds the timeout',
      '  --fixture-invalid-output <name>',
      '                               a glyph whose handler returns invalid output',
      '',
      'example: glyph-conformance http://localhost:3100 --level all \\',
      '           --fixture-echo conformance-echo \\',
      '           --output report.json --markdown report.md',
    ].join('\n')
  )
  process.exit(args.baseUrl ? 0 : 2)
}

const report = await runConformance(args.baseUrl, {
  levels: args.levels,
  fixtures: args.fixtures,
  authToken: args.authToken,
})
console.log(formatReport(report))

if (args.output) writeFileSync(args.output, JSON.stringify(report, null, 2))
if (args.markdown) writeFileSync(args.markdown, formatReportMarkdown(report))

process.exit(report.passed ? 0 : 1)
