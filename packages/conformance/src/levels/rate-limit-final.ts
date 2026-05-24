import type { CheckResult, LevelRunner } from '../types.js'

/**
 * `security.rateLimit` runs as the final check across the whole suite —
 * not inside `securityLevel` — because the burst it sends drains the
 * server's rate-limit bucket. If it ran in-line with the other security
 * checks, the subsequent `security.timeout` request and every governance
 * check would land in the same window and receive `429`s instead of the
 * codes they actually test for.
 *
 * The emitted CheckResult keeps `level: 'security'` and the historic name
 * `security.rateLimit` so the JSON report, badge, and any downstream
 * consumers see no schema change — only the moment of execution moves.
 */
export const rateLimitFinalCheck: LevelRunner = async (ctx) => {
  const checks: CheckResult[] = []
  const add = (status: 'passed' | 'failed' | 'skipped', detail: string) =>
    checks.push({
      name: 'security.rateLimit',
      level: 'security',
      status,
      detail,
    })

  const echo = ctx.fixtures.echo
  if (!echo || !ctx.lexiconNames.includes(echo)) {
    add('skipped', 'fixtures.echo required for a rate-limit burst')
    return checks
  }

  try {
    let sawLimit = false
    for (let i = 0; i < 200; i++) {
      const { status } = await ctx.http(
        'POST',
        `/glyphs/${encodeURIComponent(echo)}/call`,
        { input: { value: 'x' } }
      )
      if (status === 429) {
        sawLimit = true
        break
      }
    }
    add(
      sawLimit ? 'passed' : 'skipped',
      sawLimit
        ? 'burst eventually produced 429'
        : 'no 429 within 200 calls — server may have rate limit disabled'
    )
  } catch (e) {
    add('failed', e instanceof Error ? e.message : String(e))
  }
  return checks
}
