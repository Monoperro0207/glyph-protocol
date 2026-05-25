import { PROTOCOL_VERSION } from '@glyphp/types'
import { discoveryLevel } from './levels/discovery.js'
import { executionLevel } from './levels/execution.js'
import { governanceLevel } from './levels/governance.js'
import { securityLevel } from './levels/security.js'
import { validators } from './schemas.js'
import {
  ALL_LEVELS,
  type CheckResult,
  type ConformanceLevel,
  type ConformanceOptions,
  type ConformanceReport,
  type FetchLike,
  type HttpFn,
  type LevelContext,
  type LevelRunner,
  type LevelSummary,
} from './types.js'

const RUNNERS: Record<ConformanceLevel, LevelRunner> = {
  discovery: discoveryLevel,
  execution: executionLevel,
  security: securityLevel,
  governance: governanceLevel,
}

/**
 * Runs the Glyph conformance suite against a server and produces a report.
 *
 * Each level is independent: `discovery` always runs first to populate the
 * lexicon, then execution/security/governance run in order. A server passes a
 * level when every check in that level is `passed` (skipped is allowed for
 * fixtures the server chose not to expose).
 */
export async function runConformance(
  baseUrl: string,
  options: ConformanceOptions = {},
): Promise<ConformanceReport> {
  const doFetch: FetchLike = options.fetch ?? ((req) => globalThis.fetch(req))
  const base = baseUrl.replace(/\/$/, '')
  const requested = options.levels ?? ALL_LEVELS
  const ctx: LevelContext = {
    baseUrl: base,
    http: buildHttp(base, doFetch, options.authToken),
    validators: validators as unknown as LevelContext['validators'],
    fixtures: options.fixtures ?? {},
    authToken: options.authToken,
    lexiconNames: [],
  }

  // Discovery must always run before execution/security/governance, because
  // those consume `lexiconNames`. If the caller skipped discovery, populate
  // lexiconNames lazily so dependent levels can still attempt to run.
  const ordered: ConformanceLevel[] = []
  if (requested.includes('discovery') || requested.length < ALL_LEVELS.length) {
    if (requested.includes('discovery')) ordered.push('discovery')
  }
  for (const level of ALL_LEVELS) {
    if (level === 'discovery') continue
    if (requested.includes(level)) ordered.push(level)
  }

  // If discovery isn't selected but dependent levels are, populate lexiconNames
  // via a quiet lexicon fetch so those levels still have something to test.
  if (!requested.includes('discovery') && requested.length > 0) {
    try {
      const lex = await ctx.http('GET', '/lexicon')
      if (lex.status === 200 && Array.isArray(lex.json)) {
        ctx.lexiconNames = lex.json
          .map((e: any) => e?.name)
          .filter((n: any): n is string => typeof n === 'string')
      }
    } catch {
      /* ignore — dependent levels will skip their fixture-dependent checks */
    }
  }

  const checks: CheckResult[] = []
  for (const level of ordered) {
    const runner = RUNNERS[level]
    const levelChecks = await runner(ctx)
    checks.push(...levelChecks)
  }

  const levels: LevelSummary[] = []
  const compatibility: ConformanceLevel[] = []
  for (const level of requested) {
    const levelChecks = checks.filter((c) => c.level === level)
    const passed = levelChecks.filter((c) => c.status === 'passed').length
    const failed = levelChecks.filter((c) => c.status === 'failed').length
    const skipped = levelChecks.filter((c) => c.status === 'skipped').length
    const status: 'pass' | 'fail' = failed === 0 ? 'pass' : 'fail'
    levels.push({ level, passed, failed, skipped, status })
    if (status === 'pass') compatibility.push(level)
  }

  return {
    baseUrl: base,
    protocolVersion: PROTOCOL_VERSION,
    timestamp: new Date().toISOString(),
    passed: levels.every((l) => l.status === 'pass'),
    compatibility,
    levels,
    checks,
  }
}

/** Plain-text report for the terminal. */
export function formatReport(report: ConformanceReport): string {
  const lines: string[] = [`Glyph conformance — ${report.baseUrl}`]
  for (const summary of report.levels) {
    const tag = summary.status === 'pass' ? 'PASS' : 'FAIL'
    lines.push(
      `\n  ${tag}  ${summary.level} — ${summary.passed} passed, ${summary.failed} failed, ${summary.skipped} skipped`,
    )
    for (const check of report.checks.filter((c) => c.level === summary.level)) {
      const marker =
        check.status === 'passed' ? 'PASS' : check.status === 'failed' ? 'FAIL' : 'SKIP'
      lines.push(`    ${marker}  ${check.name} — ${check.detail}`)
    }
  }
  lines.push('')
  lines.push(
    report.passed
      ? `compatible: ${report.compatibility.join(', ')}`
      : `compatible: ${report.compatibility.join(', ') || '(none)'}`,
  )
  return lines.join('\n')
}

/** Markdown report — suitable for committing alongside a README badge. */
export function formatReportMarkdown(report: ConformanceReport): string {
  const lines: string[] = [
    `# Glyph conformance — \`${report.baseUrl}\``,
    '',
    `- protocol: ${report.protocolVersion}`,
    `- timestamp: ${report.timestamp}`,
    `- compatible: \`${report.compatibility.join(', ') || '(none)'}\``,
    '',
    '| Level | Status | Passed | Failed | Skipped |',
    '| --- | --- | --: | --: | --: |',
  ]
  for (const s of report.levels) {
    lines.push(
      `| ${s.level} | ${s.status === 'pass' ? '✅ pass' : '❌ fail'} | ${s.passed} | ${s.failed} | ${s.skipped} |`,
    )
  }
  lines.push('')
  for (const summary of report.levels) {
    lines.push(`## ${summary.level}`)
    lines.push('')
    lines.push('| Check | Result | Detail |')
    lines.push('| --- | --- | --- |')
    for (const check of report.checks.filter((c) => c.level === summary.level)) {
      const marker = check.status === 'passed' ? '✅' : check.status === 'failed' ? '❌' : '⏭'
      lines.push(`| \`${check.name}\` | ${marker} ${check.status} | ${check.detail} |`)
    }
    lines.push('')
  }
  return lines.join('\n')
}

/**
 * Shields.io endpoint-format badge for a conformance report. Drop the
 * returned JSON at a public URL and reference it with
 * `https://img.shields.io/endpoint?url=<URL>`.
 */
export function formatBadgeJson(report: ConformanceReport): {
  schemaVersion: 1
  label: string
  message: string
  color: string
} {
  const passing = report.passed
  return {
    schemaVersion: 1,
    label: `glyph conformance ${report.protocolVersion}`,
    message: passing ? report.compatibility.join(', ') || 'passing' : 'failing',
    color: passing ? 'brightgreen' : 'red',
  }
}

function buildHttp(base: string, doFetch: FetchLike, authToken?: string): HttpFn {
  return async (method, path, body, extraHeaders) => {
    const headers: Record<string, string> = {}
    if (body !== undefined && !(typeof body === 'string')) {
      headers['content-type'] = 'application/json'
    } else if (typeof body === 'string') {
      // Pre-serialised body (used to test MALFORMED_JSON). Send raw text.
      headers['content-type'] = 'application/json'
    }
    if (authToken) headers.authorization = `Bearer ${authToken}`
    if (extraHeaders) {
      for (const [k, v] of Object.entries(extraHeaders)) {
        if (v === '') delete headers[k.toLowerCase()]
        else headers[k.toLowerCase()] = v
      }
    }

    const req = new Request(`${base}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    })
    const res = await doFetch(req)
    const text = await res.text()
    let json: any
    try {
      json = text ? JSON.parse(text) : undefined
    } catch {
      json = undefined
    }
    return { status: res.status, headers: res.headers, json, text }
  }
}

export type { CheckResult, ConformanceOptions, ConformanceReport, FetchLike }
export { ALL_LEVELS }
