import { verifyReceipt } from '@glyphp/core'
import type { CheckResult, LevelRunner } from '../types.js'

/**
 * Execution level — actually calls glyphs. Requires the server-under-test to
 * expose at least the `echo` fixture (a side-effect-free glyph that takes
 * `{ value: string }` and returns it). Optional fixtures cover input/output
 * validation and sanitization edge cases.
 */
export const executionLevel: LevelRunner = async (ctx) => {
  const checks: CheckResult[] = []
  const add = (name: string, status: 'passed' | 'failed' | 'skipped', detail: string) =>
    checks.push({ name, level: 'execution', status, detail })

  const echo = ctx.fixtures.echo
  if (!echo || !ctx.lexiconNames.includes(echo)) {
    add(
      'execution.call.success',
      'skipped',
      'fixtures.echo not declared or not present in /lexicon',
    )
    add('execution.call.receipt', 'skipped', 'depends on execution.call.success')
    add('execution.call.envelope', 'skipped', 'depends on execution.call.success')
    add('execution.call.sanitization', 'skipped', 'depends on execution.call.success')
  } else {
    // 1. POST /call succeeds with valid input and returns a SealedEnvelope
    try {
      const { status, json } = await ctx.http('POST', `/glyphs/${encodeURIComponent(echo)}/call`, {
        input: { value: 'hello' },
      })
      const envelopeOk = status === 200 && ctx.validators.sealedEnvelope(json) === true
      add(
        'execution.call.success',
        envelopeOk ? 'passed' : 'failed',
        envelopeOk
          ? `POST /glyphs/${echo}/call → 200 SealedEnvelope`
          : `expected 200 SealedEnvelope, got ${status}`,
      )

      if (envelopeOk) {
        // 2. Envelope shape
        add(
          'execution.call.envelope',
          json.type === 'data' && typeof json.payload === 'object' ? 'passed' : 'failed',
          'envelope.type=data with payload',
        )

        // 3. Receipt signature verifies end-to-end
        try {
          const receiptOk = verifyReceipt(json.receipt)
          add(
            'execution.call.receipt',
            receiptOk ? 'passed' : 'failed',
            receiptOk
              ? 'receipt signature verifies against the server public key'
              : 'receipt signature did not verify',
          )
        } catch (e) {
          add('execution.call.receipt', 'failed', errMsg(e))
        }

        // 4. Sanitization report is present and well-shaped
        const inspection = json.inspection
        const sanitOk = inspection && ctx.validators.sanitization(inspection) === true
        add(
          'execution.call.sanitization',
          sanitOk ? 'passed' : 'failed',
          sanitOk
            ? 'envelope.inspection is a valid Sanitization report'
            : 'inspection missing or malformed',
        )
      } else {
        add('execution.call.envelope', 'failed', 'envelope was not valid')
        add('execution.call.receipt', 'failed', 'envelope was not valid')
        add('execution.call.sanitization', 'failed', 'envelope was not valid')
      }
    } catch (e) {
      add('execution.call.success', 'failed', errMsg(e))
      add('execution.call.envelope', 'failed', errMsg(e))
      add('execution.call.receipt', 'failed', errMsg(e))
      add('execution.call.sanitization', 'failed', errMsg(e))
    }

    // 5. Input validation — wrong type rejected
    try {
      const { status, json } = await ctx.http('POST', `/glyphs/${encodeURIComponent(echo)}/call`, {
        input: { value: 123 },
      })
      const ok =
        status === 400 &&
        ctx.validators.glyphError(json) === true &&
        json.error.code === 'VALIDATION_FAILED'
      add(
        'execution.call.inputValidation',
        ok ? 'passed' : 'failed',
        ok
          ? 'invalid input → 400 VALIDATION_FAILED'
          : `expected 400 VALIDATION_FAILED, got ${status} ${json?.error?.code ?? ''}`,
      )
    } catch (e) {
      add('execution.call.inputValidation', 'failed', errMsg(e))
    }

    // 6. Malformed JSON body
    try {
      const { status, json } = await ctx.http(
        'POST',
        `/glyphs/${encodeURIComponent(echo)}/call`,
        '{not json',
      )
      const ok =
        status === 400 &&
        ctx.validators.glyphError(json) === true &&
        json.error.code === 'MALFORMED_JSON'
      add(
        'execution.call.malformedJson',
        ok ? 'passed' : 'failed',
        ok
          ? 'non-JSON body → 400 MALFORMED_JSON'
          : `expected 400 MALFORMED_JSON, got ${status} ${json?.error?.code ?? ''}`,
      )
    } catch (e) {
      add('execution.call.malformedJson', 'failed', errMsg(e))
    }
  }

  // 7. Output validation fixture — if exposed, the server should yield
  //    502 OUTPUT_VALIDATION_FAILED when its handler violates the card schema.
  const invalidOutput = ctx.fixtures.invalidOutput
  if (!invalidOutput || !ctx.lexiconNames.includes(invalidOutput)) {
    add('execution.call.outputValidation', 'skipped', 'fixtures.invalidOutput not declared')
  } else {
    try {
      const { status, json } = await ctx.http(
        'POST',
        `/glyphs/${encodeURIComponent(invalidOutput)}/call`,
        { input: {} },
      )
      const ok =
        status === 502 &&
        ctx.validators.glyphError(json) === true &&
        json.error.code === 'OUTPUT_VALIDATION_FAILED'
      add(
        'execution.call.outputValidation',
        ok ? 'passed' : 'failed',
        ok
          ? 'mismatched handler output → 502 OUTPUT_VALIDATION_FAILED'
          : `expected 502 OUTPUT_VALIDATION_FAILED, got ${status} ${json?.error?.code ?? ''}`,
      )
    } catch (e) {
      add('execution.call.outputValidation', 'failed', errMsg(e))
    }
  }

  return checks
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
