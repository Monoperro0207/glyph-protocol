import { verifyGlyph } from '@glyphp/core'
import { PROTOCOL_VERSION } from '@glyphp/types'
import type { GlyphCard, LexiconEntry } from '@glyphp/types'
import type { CheckResult, LevelContext, LevelRunner } from '../types.js'

/**
 * Discovery level — what a client sees before it ever calls a tool: health,
 * handshake, lexicon, card shape and signature, depth handling, error envelope.
 *
 * This level is enough on its own to certify that a server *announces* itself
 * correctly; execution and security are still required to certify behaviour.
 */
export const discoveryLevel: LevelRunner = async (ctx) => {
  const checks: CheckResult[] = []
  const add = (
    name: string,
    status: 'passed' | 'failed' | 'skipped',
    detail: string
  ) => checks.push({ name, level: 'discovery', status, detail })

  // 1. /health
  try {
    const { status, json } = await ctx.http('GET', '/health')
    const ok =
      status === 200 &&
      json?.ok === true &&
      typeof json?.protocolVersion === 'string'
    add(
      'discovery.health',
      ok ? 'passed' : 'failed',
      ok
        ? `protocolVersion=${json.protocolVersion}`
        : `expected 200 + {ok,protocolVersion}, got ${status}`
    )
  } catch (e) {
    add('discovery.health', 'failed', errMsg(e))
  }

  // 2. handshake — accepts supported version
  let lexicon: LexiconEntry[] = []
  try {
    const { status, json } = await ctx.http('POST', '/handshake', {
      protocolVersion: PROTOCOL_VERSION,
      consumerId: 'glyph-conformance',
      contextBudget: 50000,
      preferredCardDepth: 'standard',
    })
    const ok = status === 200 && ctx.validators.handshakeResponse(json) === true
    add(
      'discovery.handshake.accept',
      ok ? 'passed' : 'failed',
      ok
        ? 'valid HandshakeResponse'
        : `expected 200 + HandshakeResponse, got ${status}`
    )
    if (ok) lexicon = json.lexicon
  } catch (e) {
    add('discovery.handshake.accept', 'failed', errMsg(e))
  }

  // 3. handshake — rejects unsupported version
  try {
    const { status, json } = await ctx.http('POST', '/handshake', {
      protocolVersion: '0.0-conformance-bogus',
      consumerId: 'glyph-conformance',
      contextBudget: 50000,
      preferredCardDepth: 'standard',
    })
    const ok =
      status === 426 &&
      ctx.validators.glyphError(json) === true &&
      json.error.code === 'PROTOCOL_VERSION_UNSUPPORTED'
    add(
      'discovery.handshake.reject',
      ok ? 'passed' : 'failed',
      ok
        ? 'version mismatch → 426 PROTOCOL_VERSION_UNSUPPORTED'
        : `expected 426 PROTOCOL_VERSION_UNSUPPORTED, got ${status} ${
            json?.error?.code ?? ''
          }`
    )
  } catch (e) {
    add('discovery.handshake.reject', 'failed', errMsg(e))
  }

  // 4. /lexicon
  try {
    const { status, json } = await ctx.http('GET', '/lexicon')
    const ok =
      status === 200 &&
      Array.isArray(json) &&
      json.every((e: unknown) => ctx.validators.lexiconEntry(e) === true)
    add(
      'discovery.lexicon',
      ok ? 'passed' : 'failed',
      ok
        ? `${json.length} entr${json.length === 1 ? 'y' : 'ies'}`
        : `expected 200 + LexiconEntry[], got ${status}`
    )
    if (ok && lexicon.length === 0) lexicon = json
  } catch (e) {
    add('discovery.lexicon', 'failed', errMsg(e))
  }

  ctx.lexiconNames = lexicon.map((e) => e.name)

  // 5 + 6. card shape and signature for the first advertised glyph
  if (lexicon.length === 0) {
    add('discovery.card.shape', 'skipped', 'no glyphs advertised')
    add('discovery.card.signature', 'skipped', 'no glyphs advertised')
  } else {
    const name = lexicon[0].name
    try {
      const { status, json } = await ctx.http(
        'GET',
        `/glyphs/${encodeURIComponent(name)}?depth=rich`
      )
      const shapeOk = status === 200 && ctx.validators.glyphCard(json) === true
      add(
        'discovery.card.shape',
        shapeOk ? 'passed' : 'failed',
        shapeOk
          ? `'${name}' is a valid GlyphCard`
          : `expected a valid GlyphCard, got ${status}`
      )
      if (shapeOk) {
        const sigOk = verifyGlyph(json as GlyphCard)
        add(
          'discovery.card.signature',
          sigOk ? 'passed' : 'failed',
          sigOk
            ? `'${name}' signature and content hash verify`
            : 'signature or content-hash check failed'
        )
      } else {
        add(
          'discovery.card.signature',
          'failed',
          'card shape invalid — cannot check signature'
        )
      }
    } catch (e) {
      add('discovery.card.shape', 'failed', errMsg(e))
      add('discovery.card.signature', 'failed', errMsg(e))
    }
  }

  // 7. depth enum validation — bogus values must be rejected explicitly.
  const probeName = lexicon[0]?.name ?? '__conformance_unknown__'
  try {
    const { status, json } = await ctx.http(
      'GET',
      `/glyphs/${encodeURIComponent(probeName)}?depth=bogus`
    )
    const ok =
      status === 400 &&
      ctx.validators.glyphError(json) === true &&
      json.error.code === 'VALIDATION_FAILED'
    add(
      'discovery.card.depthEnum',
      ok ? 'passed' : 'failed',
      ok
        ? "depth=bogus → 400 VALIDATION_FAILED"
        : `expected 400 VALIDATION_FAILED, got ${status} ${
            json?.error?.code ?? ''
          }`
    )
  } catch (e) {
    add('discovery.card.depthEnum', 'failed', errMsg(e))
  }

  // 8. NOT_FOUND envelope for an unknown glyph
  try {
    const { status, json } = await ctx.http(
      'GET',
      '/glyphs/__conformance_unknown__'
    )
    const ok =
      status === 404 &&
      ctx.validators.glyphError(json) === true &&
      json.error.code === 'NOT_FOUND'
    add(
      'discovery.error.notFound',
      ok ? 'passed' : 'failed',
      ok
        ? 'unknown glyph → 404 NOT_FOUND'
        : `expected 404 NOT_FOUND, got ${status} ${json?.error?.code ?? ''}`
    )
  } catch (e) {
    add('discovery.error.notFound', 'failed', errMsg(e))
  }

  // 9. local schema sanity — guards against schema drift in the bundled copy.
  try {
    const ok =
      ctx.validators.sanitization({
        modified: true,
        findings: [{ path: '/msg', kind: 'bidi-override', count: 1 }],
      }) === true &&
      ctx.validators.sanitization({ modified: false, findings: [] }) === true &&
      ctx.validators.sanitization({ modified: 'yes', findings: [] }) !== true
    add(
      'discovery.schema.sanitization',
      ok ? 'passed' : 'failed',
      ok
        ? 'bundled Sanitization schema validates representative samples'
        : 'bundled Sanitization schema is inconsistent'
    )
  } catch (e) {
    add('discovery.schema.sanitization', 'failed', errMsg(e))
  }

  return checks
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
