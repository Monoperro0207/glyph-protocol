import { verifyGlyph } from '@glyphp/core'
import { PROTOCOL_VERSION } from '@glyphp/types'
import type { GlyphCard, LexiconEntry } from '@glyphp/types'
import type { ValidateFunction } from 'ajv'
import { validators } from './schemas.js'

export interface CheckResult {
  /** Stable identifier for the check, e.g. "handshake.reject". */
  name: string
  passed: boolean
  /** Human-readable explanation of the outcome. */
  detail: string
}

export interface ConformanceReport {
  baseUrl: string
  protocolVersion: string
  passed: boolean
  checks: CheckResult[]
}

/** A request handler — `globalThis.fetch`, or a server's in-process `fetch`. */
export type FetchLike = (req: Request) => Promise<Response> | Response

export interface ConformanceOptions {
  /** Defaults to `globalThis.fetch`. Pass a server's `fetch` to test in-process. */
  fetch?: FetchLike
}

/**
 * Runs the Glyph conformance suite against a server and returns a report.
 *
 * The suite is non-destructive: it exercises discovery and error handling
 * only, never calls a glyph (which would require knowing valid inputs).
 */
export async function runConformance(
  baseUrl: string,
  options: ConformanceOptions = {}
): Promise<ConformanceReport> {
  const doFetch: FetchLike = options.fetch ?? ((req) => globalThis.fetch(req))
  const base = baseUrl.replace(/\/$/, '')
  const checks: CheckResult[] = []
  const add = (name: string, passed: boolean, detail: string) =>
    checks.push({ name, passed, detail })

  async function http(
    method: string,
    path: string,
    body?: unknown
  ): Promise<{ status: number; json: any }> {
    const req = new Request(`${base}${path}`, {
      method,
      headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    const res = await doFetch(req)
    let json: any
    try {
      json = await res.json()
    } catch {
      json = undefined
    }
    return { status: res.status, json }
  }

  // 1. /health
  try {
    const { status, json } = await http('GET', '/health')
    const ok =
      status === 200 &&
      json?.ok === true &&
      typeof json?.protocolVersion === 'string'
    add(
      'health',
      ok,
      ok ? `protocolVersion=${json.protocolVersion}` : `expected 200 + {ok,protocolVersion}, got ${status}`
    )
  } catch (e) {
    add('health', false, errMsg(e))
  }

  // 2. handshake — accepts the supported protocol version
  let lexicon: LexiconEntry[] = []
  try {
    const { status, json } = await http('POST', '/handshake', {
      protocolVersion: PROTOCOL_VERSION,
      consumerId: 'glyph-conformance',
      contextBudget: 50000,
      preferredCardDepth: 'standard',
    })
    const ok = status === 200 && valid(validators.handshakeResponse, json)
    add(
      'handshake.accept',
      ok,
      ok ? 'valid HandshakeResponse' : schemaDetail(status, 200, validators.handshakeResponse)
    )
    if (ok) lexicon = json.lexicon
  } catch (e) {
    add('handshake.accept', false, errMsg(e))
  }

  // 3. handshake — rejects an unsupported protocol version
  try {
    const { status, json } = await http('POST', '/handshake', {
      protocolVersion: '0.0-conformance-bogus',
      consumerId: 'glyph-conformance',
      contextBudget: 50000,
      preferredCardDepth: 'standard',
    })
    const ok =
      status === 426 &&
      valid(validators.glyphError, json) &&
      json.error.code === 'PROTOCOL_VERSION_UNSUPPORTED'
    add(
      'handshake.reject',
      ok,
      ok
        ? 'rejects a version mismatch with 426 PROTOCOL_VERSION_UNSUPPORTED'
        : `expected 426 PROTOCOL_VERSION_UNSUPPORTED, got ${status} ${json?.error?.code ?? ''}`
    )
  } catch (e) {
    add('handshake.reject', false, errMsg(e))
  }

  // 4. /lexicon
  try {
    const { status, json } = await http('GET', '/lexicon')
    const ok =
      status === 200 &&
      Array.isArray(json) &&
      json.every((e: unknown) => valid(validators.lexiconEntry, e))
    add(
      'lexicon',
      ok,
      ok ? `${json.length} entr${json.length === 1 ? 'y' : 'ies'}` : `expected 200 + LexiconEntry[], got ${status}`
    )
    if (ok && lexicon.length === 0) lexicon = json
  } catch (e) {
    add('lexicon', false, errMsg(e))
  }

  // 5 + 6. card shape and signature, against the first advertised glyph
  if (lexicon.length === 0) {
    add('card.shape', false, 'no glyphs advertised — nothing to check')
    add('card.signature', false, 'no glyphs advertised — nothing to check')
  } else {
    const name = lexicon[0].name
    try {
      const { status, json } = await http(
        'GET',
        `/glyphs/${encodeURIComponent(name)}?depth=rich`
      )
      const shapeOk = status === 200 && valid(validators.glyphCard, json)
      add(
        'card.shape',
        shapeOk,
        shapeOk ? `'${name}' is a valid GlyphCard` : schemaDetail(status, 200, validators.glyphCard)
      )
      if (shapeOk) {
        const sigOk = verifyGlyph(json as GlyphCard)
        add(
          'card.signature',
          sigOk,
          sigOk ? `'${name}' signature and content hash verify` : 'signature or content-hash check failed'
        )
      } else {
        add('card.signature', false, 'card shape invalid — cannot check the signature')
      }
    } catch (e) {
      add('card.shape', false, errMsg(e))
      add('card.signature', false, errMsg(e))
    }
  }

  // 7. error envelope on an unknown glyph
  try {
    const { status, json } = await http('GET', '/glyphs/__conformance_unknown__')
    const ok =
      status === 404 &&
      valid(validators.glyphError, json) &&
      json.error.code === 'NOT_FOUND'
    add(
      'error.notFound',
      ok,
      ok
        ? 'unknown glyph returns 404 NOT_FOUND in the GlyphError envelope'
        : `expected 404 NOT_FOUND, got ${status} ${json?.error?.code ?? ''}`
    )
  } catch (e) {
    add('error.notFound', false, errMsg(e))
  }

  // 8. the bundled v0.2 inspection schema validates representative samples.
  // Non-destructive: this exercises the schema set, not a glyph call.
  try {
    const ok =
      valid(validators.sanitization, {
        modified: true,
        findings: [{ path: '/msg', kind: 'bidi-override', count: 1 }],
      }) &&
      valid(validators.sanitization, { modified: false, findings: [] }) &&
      !valid(validators.sanitization, { modified: 'yes', findings: [] })
    add(
      'schema.sanitization',
      ok,
      ok
        ? 'the Sanitization schema validates representative samples'
        : 'the bundled Sanitization schema is inconsistent'
    )
  } catch (e) {
    add('schema.sanitization', false, errMsg(e))
  }

  return {
    baseUrl: base,
    protocolVersion: PROTOCOL_VERSION,
    passed: checks.every((c) => c.passed),
    checks,
  }
}

/** Renders a report as plain text for terminal output. */
export function formatReport(report: ConformanceReport): string {
  const lines = report.checks.map(
    (c) => `  ${c.passed ? 'PASS' : 'FAIL'}  ${c.name} — ${c.detail}`
  )
  const failed = report.checks.filter((c) => !c.passed).length
  const summary = report.passed
    ? `PASS — ${report.checks.length}/${report.checks.length} checks`
    : `FAIL — ${failed}/${report.checks.length} checks failed`
  return [`Glyph conformance — ${report.baseUrl}`, ...lines, summary].join('\n')
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/** Runs a validator, returning a plain boolean — discards the type predicate. */
function valid(validate: ValidateFunction, data: unknown): boolean {
  return validate(data) === true
}

function schemaDetail(
  status: number,
  expected: number,
  validate: ValidateFunction
): string {
  if (status !== expected) return `expected HTTP ${expected}, got ${status}`
  const err = validate.errors?.[0]
  return err ? `schema: ${err.instancePath || '/'} ${err.message}` : 'schema mismatch'
}
