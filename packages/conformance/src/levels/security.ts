import type { CheckResult, LevelRunner } from '../types.js'

/**
 * Security level — confirmation gate, auth and handler timeout.
 *
 * Confirmation tests require `fixtures.requiresConfirmation`; the timeout
 * check requires `fixtures.slow` and is skipped when absent.
 *
 * Note: `security.rateLimit` is **not** run here. It lives in
 * `./rate-limit-final.ts` and runs as the very last check across the whole
 * suite, because the burst it sends drains the server's rate-limit bucket
 * and would otherwise contaminate every check that runs after it.
 */
export const securityLevel: LevelRunner = async (ctx) => {
  const checks: CheckResult[] = []
  const add = (
    name: string,
    status: 'passed' | 'failed' | 'skipped',
    detail: string
  ) => checks.push({ name, level: 'security', status, detail })

  // 1+2+3. Confirmation gate — missing vs bogus vs valid token
  const reqConf = ctx.fixtures.requiresConfirmation
  if (!reqConf || !ctx.lexiconNames.includes(reqConf)) {
    add(
      'security.confirmation.required',
      'skipped',
      'fixtures.requiresConfirmation not declared'
    )
    add(
      'security.confirmation.invalid',
      'skipped',
      'fixtures.requiresConfirmation not declared'
    )
    add(
      'security.confirmation.unlocks',
      'skipped',
      'fixtures.requiresConfirmation not declared'
    )
  } else {
    // Missing token → CONFIRMATION_REQUIRED
    try {
      const { status, json } = await ctx.http(
        'POST',
        `/glyphs/${encodeURIComponent(reqConf)}/call`,
        { input: {} }
      )
      const ok =
        status === 403 &&
        ctx.validators.glyphError(json) === true &&
        json.error.code === 'CONFIRMATION_REQUIRED'
      add(
        'security.confirmation.required',
        ok ? 'passed' : 'failed',
        ok
          ? 'no token → 403 CONFIRMATION_REQUIRED'
          : `expected 403 CONFIRMATION_REQUIRED, got ${status} ${
              json?.error?.code ?? ''
            }`
      )
    } catch (e) {
      add('security.confirmation.required', 'failed', errMsg(e))
    }

    // Bogus token → INVALID_CONFIRMATION (not CONFIRMATION_REQUIRED)
    try {
      const { status, json } = await ctx.http(
        'POST',
        `/glyphs/${encodeURIComponent(reqConf)}/call`,
        { input: {}, confirmationToken: 'not-a-real-token' }
      )
      const ok =
        status === 403 &&
        ctx.validators.glyphError(json) === true &&
        json.error.code === 'INVALID_CONFIRMATION'
      add(
        'security.confirmation.invalid',
        ok ? 'passed' : 'failed',
        ok
          ? 'bogus token → 403 INVALID_CONFIRMATION'
          : `expected 403 INVALID_CONFIRMATION, got ${status} ${
              json?.error?.code ?? ''
            }`
      )
    } catch (e) {
      add('security.confirmation.invalid', 'failed', errMsg(e))
    }

    // Prepare + valid token → 200
    try {
      const prep = await ctx.http(
        'POST',
        `/glyphs/${encodeURIComponent(reqConf)}/prepare`,
        { input: {} }
      )
      if (
        prep.status === 200 &&
        ctx.validators.confirmationTicket(prep.json) === true
      ) {
        const { status, json } = await ctx.http(
          'POST',
          `/glyphs/${encodeURIComponent(reqConf)}/call`,
          { input: {}, confirmationToken: prep.json.confirmationToken }
        )
        const ok =
          status === 200 && ctx.validators.sealedEnvelope(json) === true
        add(
          'security.confirmation.unlocks',
          ok ? 'passed' : 'failed',
          ok
            ? 'valid token unlocks the call'
            : `expected 200 SealedEnvelope, got ${status}`
        )
      } else {
        add(
          'security.confirmation.unlocks',
          'failed',
          `prepare did not return a ConfirmationTicket (status ${prep.status})`
        )
      }
    } catch (e) {
      add('security.confirmation.unlocks', 'failed', errMsg(e))
    }
  }

  // 4. Auth — server requires bearer token when one is configured for tests.
  //    If no authToken in options, this is a non-applicable check.
  if (!ctx.authToken) {
    add(
      'security.auth.required',
      'skipped',
      'no authToken supplied — server is assumed open'
    )
  } else {
    try {
      const { status } = await ctx.http(
        'GET',
        '/lexicon',
        undefined,
        // intentionally omit auth header
        { authorization: '' }
      )
      const ok = status === 401 || status === 403
      add(
        'security.auth.required',
        ok ? 'passed' : 'failed',
        ok
          ? `unauthenticated request → ${status}`
          : `expected 401/403, got ${status}`
      )
    } catch (e) {
      add('security.auth.required', 'failed', errMsg(e))
    }
  }

  // 5. Timeout — fixture handler that exceeds the timeout must produce 504.
  const slow = ctx.fixtures.slow
  if (!slow || !ctx.lexiconNames.includes(slow)) {
    add('security.timeout', 'skipped', 'fixtures.slow not declared')
  } else {
    try {
      const { status, json } = await ctx.http(
        'POST',
        `/glyphs/${encodeURIComponent(slow)}/call`,
        { input: {} }
      )
      const ok =
        status === 504 &&
        ctx.validators.glyphError(json) === true &&
        json.error.code === 'HANDLER_TIMEOUT'
      add(
        'security.timeout',
        ok ? 'passed' : 'failed',
        ok
          ? 'slow handler → 504 HANDLER_TIMEOUT'
          : `expected 504 HANDLER_TIMEOUT, got ${status} ${
              json?.error?.code ?? ''
            }`
      )
    } catch (e) {
      add('security.timeout', 'failed', errMsg(e))
    }
  }

  return checks
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
