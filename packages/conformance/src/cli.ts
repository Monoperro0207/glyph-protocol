#!/usr/bin/env node
import { writeFileSync } from 'node:fs'
import {
  ALL_LEVELS,
  formatReport,
  formatReportMarkdown,
  PROFILE_LEVELS,
  runConformance,
} from './conformance.js'
import type { ConformanceLevel, ConformanceProfile, FixtureGlyphs } from './types.js'

interface Args {
  baseUrl?: string
  levels?: ConformanceLevel[]
  profile?: ConformanceProfile
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
    else if (arg === '--profile') {
      const value = argv[++i] ?? ''
      if (value in PROFILE_LEVELS) {
        out.profile = value as ConformanceProfile
      } else {
        console.error(
          `unknown profile "${value}" — valid: ${Object.keys(PROFILE_LEVELS).join(', ')}`,
        )
        process.exit(2)
      }
    } else if (arg === '--level' || arg === '--levels') {
      const value = argv[++i] ?? ''
      // Preset profile names resolve to the corresponding level list.
      if (value in PROFILE_LEVELS) {
        out.levels = [...PROFILE_LEVELS[value as ConformanceProfile]]
      } else if (value === 'all') {
        out.levels = Array.from(ALL_LEVELS)
      } else {
        out.levels = value
          .split(',')
          .map((s) => s.trim() as ConformanceLevel)
          .filter((s) => (ALL_LEVELS as readonly string[]).includes(s))
      }
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
      '  --level <preset|list|all>      profile preset or comma-separated levels',
      '    presets:  minimal  = discovery + execution',
      '              secure   = discovery + execution + security (default)',
      '              production = all four levels',
      '    list:     discovery, execution, security, governance',
      '  --profile <preset>            same as --level with a preset name',
      '  --output <file>               write report JSON',
      '  --markdown <file>             write report as markdown',
      '  --auth-token <token>          bearer token for protected servers',
      '                                 (required for production-level gates)',
      '  --fixture-echo <name>         a safe echo glyph (execution level)',
      '  --fixture-requires-confirmation <name>',
      '                                a glyph that requires confirmation (security)',
      '  --fixture-slow <name>         a glyph whose handler exceeds the timeout',
      '  --fixture-invalid-output <name>',
      '                                a glyph whose handler returns invalid output',
      '',
      'example: glyph-conformance http://localhost:3100 --level production \\',
      '           --auth-token my-secret \\',
      '           --fixture-echo conformance-echo \\',
      '           --output report.json --markdown report.md',
    ].join('\n'),
  )
  process.exit(args.baseUrl ? 0 : 2)
}

// ── Production-level gate (CONFPROF-003) ──
const includesGovernance =
  args.profile === 'production' ||
  (args.levels != null && args.levels.includes('governance'))

if (includesGovernance && !args.authToken) {
  console.error(
    'WARNING: production-level governance selected without --auth-token.\n' +
      'The production profile requires auth, key registry, and manifest exposure.\n' +
      'Without a token, auth-gated checks will fail. Provide --auth-token for full validation.',
  )
  // Continue — warn, don't block.
}

const report = await runConformance(args.baseUrl, {
  levels: args.levels,
  profile: args.profile,
  fixtures: args.fixtures,
  authToken: args.authToken,
})
console.log(formatReport(report))

if (args.output) writeFileSync(args.output, JSON.stringify(report, null, 2))
if (args.markdown) writeFileSync(args.markdown, formatReportMarkdown(report))

process.exit(report.passed ? 0 : 1)
