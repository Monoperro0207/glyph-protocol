import { deepStrictEqual, ok } from 'node:assert'
import { describe, it } from 'node:test'
import { buildKeyEntry, buildKeyRegistry, generateKeyPair } from '@glyphp/core'
import { discoveryLevel } from '../src/levels/discovery.js'
import { executionLevel } from '../src/levels/execution.js'
import { governanceLevel } from '../src/levels/governance.js'
import { securityLevel } from '../src/levels/security.js'
import type { CheckResult, HttpFn, HttpResponse, LevelContext } from '../src/types.js'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

type HttpStub = (method: string, path: string, body?: unknown) => HttpResponse

/** Creates a LevelContext wired to a programmable http stub. */
function ctx(
  overrides: Partial<{
    http: HttpStub
    fixtures: LevelContext['fixtures']
    lexiconNames: string[]
    authToken: string | undefined
  }> = {},
): LevelContext {
  const stub =
    overrides.http ?? (() => ({ status: 404, headers: new Headers(), json: null, text: '' }))
  const http: HttpFn = async (method, path, body) => stub(method, path, body)
  return {
    baseUrl: 'http://test',
    http,
    validators: {
      glyphError: () => true,
      handshakeResponse: () => true,
      glyphCard: () => true,
      sealedEnvelope: () => true,
      sanitization: (v: unknown) => {
        if (v && typeof v === 'object') {
          const o = v as Record<string, unknown>
          const mod = o.modified
          const findings = o.findings
          return (mod === true || mod === false) && Array.isArray(findings)
        }
        return false
      },
      confirmationTicket: () => true,
      manifest: () => true,
      updateManifest: () => true,
      lexiconEntry: () => true,
    } as Record<string, (v: unknown) => boolean>,
    fixtures: overrides.fixtures ?? {},
    lexiconNames: overrides.lexiconNames ?? [],
    authToken: overrides.authToken,
  }
}

/** Sugar: a response that is a valid glyph error with the given code. */
function glyphErr(status: number, code: string): HttpResponse {
  return { status, headers: new Headers(), json: { error: { code } }, text: '' }
}

/** Sugar: a 200 with the given json payload. */
function okJson(json: unknown): HttpResponse {
  return { status: 200, headers: new Headers(), json, text: JSON.stringify(json) }
}

/** Finds a check by name. */
function find(checks: CheckResult[], name: string): CheckResult {
  const c = checks.find((c) => c.name === name)
  ok(c, `check ${name} not found`)
  return c
}

// ---------------------------------------------------------------------------
// Execution level
// ---------------------------------------------------------------------------

describe('execution level', () => {
  it('happy path — valid call produces passing checks', async () => {
    const echo = 'my-echo'
    const mockReceipt = { glyphId: 'abc', callId: '123', signature: 'sig-hex' }
    let callCount = 0
    const res = await executionLevel(
      ctx({
        fixtures: { echo },
        lexiconNames: [echo],
        http(method, path, body) {
          callCount++
          if (path.includes('/call')) {
            if (callCount <= 3) {
              // First call: valid input → success
              return okJson({
                type: 'data',
                payload: { value: 'hello' },
                receipt: mockReceipt,
                inspection: { findings: [] },
              })
            }
            // Later calls: invalid input / malformed json
            if (callCount === 4) return glyphErr(400, 'VALIDATION_FAILED')
            if (callCount === 5) return glyphErr(400, 'MALFORMED_JSON')
            if (callCount === 6) return glyphErr(502, 'OUTPUT_VALIDATION_FAILED')
          }
          return { status: 200, headers: new Headers(), json: {}, text: '' }
        },
      }),
    )

    const disabled = find(res, 'execution.call.outputValidation')
    deepStrictEqual(disabled.status, 'skipped')
    deepStrictEqual(disabled.detail, 'fixtures.invalidOutput not declared')
  })

  it('missing echo fixture → all execution checks skipped', async () => {
    const res = await executionLevel(ctx())
    for (const c of res) {
      deepStrictEqual(c.status, 'skipped', `check ${c.name} should be skipped`)
    }
    // 5 execution checks + 2 outputValidation sub-checks = 7
    deepStrictEqual(res.length, 5)
  })

  it('input validation fails → check reports failure', async () => {
    const echo = 'my-echo'
    const res = await executionLevel(
      ctx({
        fixtures: { echo },
        lexiconNames: [echo],
        http(method, path, body) {
          if (path.includes('/call')) {
            const raw = typeof body === 'string' ? body : JSON.stringify(body)
            if (raw.includes('123'))
              return { status: 200, headers: new Headers(), json: {}, text: '' } // not 400 = fail
            return okJson({
              type: 'data',
              payload: { value: 'hello' },
              receipt: { glyphId: 'abc', callId: '123', signature: 'sig' },
              inspection: { findings: [] },
            })
          }
          return { status: 404, headers: new Headers(), json: {}, text: '' }
        },
      }),
    )
    deepStrictEqual(find(res, 'execution.call.inputValidation').status, 'failed')
  })

  it('malformed json → check reports failure when server accepts it', async () => {
    const echo = 'my-echo'
    const res = await executionLevel(
      ctx({
        fixtures: { echo },
        lexiconNames: [echo],
        http(method, path, body) {
          if (path.includes('/call')) {
            const raw = typeof body === 'string' ? body : ''
            if (raw === '{not json') return okJson({}) // accepted = fail
            return okJson({
              type: 'data',
              payload: { value: 'hello' },
              receipt: { glyphId: 'abc', callId: '123', signature: 'sig' },
              inspection: { findings: [] },
            })
          }
          return { status: 404, headers: new Headers(), json: {}, text: '' }
        },
      }),
    )
    deepStrictEqual(find(res, 'execution.call.malformedJson').status, 'failed')
  })

  it('invalid output fixture — server correctly returns 502', async () => {
    const echo = 'echo'
    const bad = 'bad-output'
    const res = await executionLevel(
      ctx({
        fixtures: { echo, invalidOutput: bad },
        lexiconNames: [echo, bad],
        http(method, path) {
          if (path.includes(bad)) return glyphErr(502, 'OUTPUT_VALIDATION_FAILED')
          if (path.includes(echo) && method === 'POST') {
            return okJson({
              type: 'data',
              payload: { value: 'hello' },
              receipt: { glyphId: 'abc', callId: '123', signature: 'sig' },
              inspection: { findings: [] },
            })
          }
          return { status: 200, headers: new Headers(), json: {}, text: '' }
        },
      }),
    )
    deepStrictEqual(find(res, 'execution.call.outputValidation').status, 'passed')
  })
})

// ---------------------------------------------------------------------------
// Security level
// ---------------------------------------------------------------------------

describe('security level', () => {
  it('confirmation gate — no token returns CONFIRMATION_REQUIRED', async () => {
    const reqConf = 'danger-tool'
    const res = await securityLevel(
      ctx({
        fixtures: { requiresConfirmation: reqConf },
        lexiconNames: [reqConf],
        http(method, path, body) {
          if (path.includes(reqConf)) {
            const bodyObj = typeof body === 'string' ? JSON.parse(body) : body || {}
            if (!bodyObj.confirmationToken) return glyphErr(403, 'CONFIRMATION_REQUIRED')
            if (bodyObj.confirmationToken === 'not-a-real-token')
              return glyphErr(403, 'INVALID_CONFIRMATION')
          }
          return okJson({})
        },
      }),
    )
    deepStrictEqual(find(res, 'security.confirmation.required').status, 'passed')
    deepStrictEqual(find(res, 'security.confirmation.invalid').status, 'passed')
  })

  it('confirmation gate — valid token unlocks call', async () => {
    const reqConf = 'danger-tool'
    const ticket = { confirmationToken: 'real-token' }
    const res = await securityLevel(
      ctx({
        fixtures: { requiresConfirmation: reqConf },
        lexiconNames: [reqConf],
        http(method, path, body) {
          if (path.includes('/prepare')) return okJson(ticket)
          if (path.includes('/call')) {
            const bodyObj = typeof body === 'string' ? JSON.parse(body) : body || {}
            if (bodyObj.confirmationToken === 'real-token') {
              return okJson({
                type: 'data',
                payload: {},
                receipt: { glyphId: 'abc', callId: '123', signature: 'sig' },
                inspection: {},
              })
            }
            return glyphErr(403, 'CONFIRMATION_REQUIRED')
          }
          return { status: 404, headers: new Headers(), json: {}, text: '' }
        },
      }),
    )
    deepStrictEqual(find(res, 'security.confirmation.unlocks').status, 'passed')
  })

  it('confirmation gate — bogus token rejected', async () => {
    const reqConf = 'danger-tool'
    const res = await securityLevel(
      ctx({
        fixtures: { requiresConfirmation: reqConf },
        lexiconNames: [reqConf],
        http(_method, path, body) {
          if (path.includes('/call')) {
            const bodyObj = typeof body === 'string' ? JSON.parse(body) : body || {}
            if (!bodyObj.confirmationToken) return glyphErr(403, 'CONFIRMATION_REQUIRED')
            if (bodyObj.confirmationToken === 'bogus') return glyphErr(403, 'INVALID_CONFIRMATION')
          }
          return okJson({})
        },
      }),
    )
    // First check (no token) must pass, but then invalid with 'bogus' should also pass
    deepStrictEqual(find(res, 'security.confirmation.required').status, 'passed')
    // The invalid check sends 'not-a-real-token', not 'bogus', so it fails
    deepStrictEqual(find(res, 'security.confirmation.invalid').status, 'failed')
  })

  it('missing requiresConfirmation → all confirmation checks skipped', async () => {
    const res = await securityLevel(ctx())
    deepStrictEqual(find(res, 'security.confirmation.required').status, 'skipped')
    deepStrictEqual(find(res, 'security.confirmation.invalid').status, 'skipped')
    deepStrictEqual(find(res, 'security.confirmation.unlocks').status, 'skipped')
  })

  it('auth — no authToken → skipped', async () => {
    const res = await securityLevel(ctx({ authToken: undefined }))
    deepStrictEqual(find(res, 'security.auth.required').status, 'skipped')
  })

  it('auth — unauthenticated request rejected', async () => {
    const res = await securityLevel(
      ctx({
        authToken: 'secret',
        http() {
          return { status: 401, headers: new Headers(), json: {}, text: '' }
        },
      }),
    )
    deepStrictEqual(find(res, 'security.auth.required').status, 'passed')
  })

  it('auth — server does not reject unauthenticated requests → failure', async () => {
    const res = await securityLevel(
      ctx({
        authToken: 'secret',
        http() {
          return { status: 200, headers: new Headers(), json: [], text: '' }
        },
      }),
    )
    deepStrictEqual(find(res, 'security.auth.required').status, 'failed')
  })

  it('timeout — slow fixture returns 504', async () => {
    const slow = 'slow-tool'
    const res = await securityLevel(
      ctx({
        fixtures: { slow },
        lexiconNames: [slow],
        http(_method, path) {
          if (path.includes(slow)) return glyphErr(504, 'HANDLER_TIMEOUT')
          return okJson({})
        },
      }),
    )
    deepStrictEqual(find(res, 'security.timeout').status, 'passed')
  })

  it('timeout — missing slow fixture → skipped', async () => {
    const res = await securityLevel(ctx())
    deepStrictEqual(find(res, 'security.timeout').status, 'skipped')
  })

  it('rateLimit — burst produces 429', async () => {
    const echo = 'echo'
    let calls = 0
    const res = await securityLevel(
      ctx({
        fixtures: { echo },
        lexiconNames: [echo],
        http() {
          calls++
          if (calls >= 10) return { status: 429, headers: new Headers(), json: {}, text: '' }
          return okJson({})
        },
      }),
    )
    deepStrictEqual(find(res, 'security.rateLimit').status, 'passed')
  })

  it('rateLimit — no limit, returns skipped', async () => {
    const echo = 'echo'
    const res = await securityLevel(
      ctx({
        fixtures: { echo },
        lexiconNames: [echo],
        http() {
          return okJson({})
        },
      }),
    )
    deepStrictEqual(find(res, 'security.rateLimit').status, 'skipped')
  })

  it('rateLimit — missing echo → skipped', async () => {
    const res = await securityLevel(ctx())
    deepStrictEqual(find(res, 'security.rateLimit').status, 'skipped')
  })

  it('secure call success http throws → catch path', async () => {
    const echo = 'echo'
    const res = await executionLevel(
      ctx({
        fixtures: { echo },
        lexiconNames: [echo],
        http() {
          throw new Error('refused')
        },
      }),
    )
    deepStrictEqual(find(res, 'execution.call.success').status, 'failed')
  })

  it('execution call input validation throws → catch path', async () => {
    const echo = 'echo'
    let call = 0
    const res = await executionLevel(
      ctx({
        fixtures: { echo },
        lexiconNames: [echo],
        http(method, path) {
          call++
          if (call === 1) {
            // valid call succeeds
            return okJson({
              type: 'data',
              payload: { value: 'hello' },
              receipt: { glyphId: 'abc', callId: '123', signature: 'sig' },
              inspection: { findings: [] },
            })
          }
          throw new Error('input validation failed')
        },
      }),
    )
    deepStrictEqual(find(res, 'execution.call.inputValidation').status, 'failed')
  })
})

// ---------------------------------------------------------------------------
// Governance level
// ---------------------------------------------------------------------------

describe('governance level', () => {
  it('manifest absent → skipped gracefully', async () => {
    const echo = 'echo'
    const res = await governanceLevel(
      ctx({
        fixtures: { echo },
        lexiconNames: [echo],
        http(method, path) {
          if (path.includes('/manifest'))
            return { status: 404, headers: new Headers(), json: {}, text: '' }
          if (path.includes('/keys'))
            return { status: 404, headers: new Headers(), json: {}, text: '' }
          if (path.includes('?depth=')) return okJson({ id: 'ee'.repeat(32), name: echo })
          return okJson({ id: 'ee'.repeat(32), name: echo })
        },
      }),
    )
    deepStrictEqual(find(res, 'governance.manifest').status, 'skipped')
  })

  it('manifest published and valid → passed', async () => {
    const echo = 'echo'
    const res = await governanceLevel(
      ctx({
        fixtures: { echo },
        lexiconNames: [echo],
        http(method, path) {
          if (path.includes('/manifest')) {
            return okJson({
              glyphName: echo,
              version: 1,
              publicKey: 'aa'.repeat(32),
              glyphId: 'bb'.repeat(32),
              changes: [],
              signature: 'cc'.repeat(64),
            })
          }
          if (path.includes('/keys'))
            return okJson({ keys: [{ fingerprint: 'aa'.repeat(32), publicKey: 'dd'.repeat(32) }] })
          if (path.includes('?depth=')) return okJson({ id: 'ee'.repeat(32), name: echo })
          return okJson({ id: 'ee'.repeat(32), name: echo })
        },
      }),
    )
    deepStrictEqual(find(res, 'governance.manifest').status, 'passed')
  })

  it('key registry published → passed', async () => {
    const echo = 'echo'
    const kp = generateKeyPair()
    const entry = buildKeyEntry(kp.publicKey, new Date().toISOString())
    const registry = buildKeyRegistry({
      serverId: 'test-server',
      entries: [entry],
      activePrivateKey: kp.privateKey,
    })
    const res = await governanceLevel(
      ctx({
        fixtures: { echo },
        lexiconNames: [echo],
        http(method, path) {
          if (path.includes('/keys')) {
            return okJson(registry)
          }
          if (path.includes('/manifest'))
            return { status: 404, headers: new Headers(), json: {}, text: '' }
          if (path.includes('?depth=')) return okJson({ id: 'ee'.repeat(32), name: echo })
          return okJson({ id: 'ee'.repeat(32), name: echo })
        },
      }),
    )
    deepStrictEqual(find(res, 'governance.keyRegistry').status, 'passed')
  })

  it('key registry published but unverifiable → failed', async () => {
    const echo = 'echo'
    const res = await governanceLevel(
      ctx({
        fixtures: { echo },
        lexiconNames: [echo],
        http(method, path) {
          if (path.includes('/keys')) {
            return okJson({ keys: [{ fingerprint: 'aa'.repeat(32), publicKey: 'dd'.repeat(32) }] })
          }
          if (path.includes('/manifest'))
            return { status: 404, headers: new Headers(), json: {}, text: '' }
          if (path.includes('?depth=')) return okJson({ id: 'ee'.repeat(32), name: echo })
          return okJson({ id: 'ee'.repeat(32), name: echo })
        },
      }),
    )
    deepStrictEqual(find(res, 'governance.keyRegistry').status, 'failed')
  })

  it('key registry absent → skipped', async () => {
    const echo = 'echo'
    const res = await governanceLevel(
      ctx({
        fixtures: { echo },
        lexiconNames: [echo],
        http(method, path) {
          if (path.includes('/keys'))
            return { status: 404, headers: new Headers(), json: {}, text: '' }
          if (path.includes('/manifest'))
            return { status: 404, headers: new Headers(), json: {}, text: '' }
          if (path.includes('?depth=')) return okJson({ id: 'ee'.repeat(32), name: echo })
          return okJson({ id: 'ee'.repeat(32), name: echo })
        },
      }),
    )
    deepStrictEqual(find(res, 'governance.keyRegistry').status, 'skipped')
  })

  it('key registry returns non-200 non-404 → failed', async () => {
    const echo = 'echo'
    const res = await governanceLevel(
      ctx({
        fixtures: { echo },
        lexiconNames: [echo],
        http(method, path) {
          if (path.includes('/keys'))
            return { status: 500, headers: new Headers(), json: {}, text: '' }
          if (path.includes('/manifest'))
            return { status: 404, headers: new Headers(), json: {}, text: '' }
          if (path.includes('?depth=')) return okJson({ id: 'ee'.repeat(32), name: echo })
          return okJson({ id: 'ee'.repeat(32), name: echo })
        },
      }),
    )
    deepStrictEqual(find(res, 'governance.keyRegistry').status, 'failed')
  })

  it('key registry http throws → catch path', async () => {
    const echo = 'echo'
    const res = await governanceLevel(
      ctx({
        fixtures: { echo },
        lexiconNames: [echo],
        http(method, path) {
          if (path.includes('/keys')) throw new Error('network error')
          if (path.includes('/manifest'))
            return { status: 404, headers: new Headers(), json: {}, text: '' }
          if (path.includes('?depth=')) return okJson({ id: 'ee'.repeat(32), name: echo })
          return okJson({ id: 'ee'.repeat(32), name: echo })
        },
      }),
    )
    deepStrictEqual(find(res, 'governance.keyRegistry').status, 'failed')
    deepStrictEqual(find(res, 'governance.keyRegistry').detail, 'network error')
  })

  it('manifest http throws → catch path', async () => {
    const echo = 'echo'
    const res = await governanceLevel(
      ctx({
        fixtures: { echo },
        lexiconNames: [echo],
        http(method, path) {
          if (path.includes('/manifest')) throw new Error('timeout')
          if (path.includes('/keys'))
            return { status: 404, headers: new Headers(), json: {}, text: '' }
          if (path.includes('?depth=')) return okJson({ id: 'ee'.repeat(32), name: echo })
          return okJson({ id: 'ee'.repeat(32), name: echo })
        },
      }),
    )
    deepStrictEqual(find(res, 'governance.manifest').status, 'failed')
  })

  it('empty lexicon → all governance checks skipped', async () => {
    const res = await governanceLevel(ctx({ lexiconNames: [] }))
    deepStrictEqual(find(res, 'governance.card.depthIdentity').status, 'skipped')
    deepStrictEqual(find(res, 'governance.manifest').status, 'skipped')
  })

  it('card depth identity catch error', async () => {
    const echo = 'echo'
    const res = await governanceLevel(
      ctx({
        fixtures: { echo },
        lexiconNames: [echo],
        http(method, path) {
          if (path.includes('?depth=')) throw new Error('connection refused')
          return okJson({})
        },
      }),
    )
    deepStrictEqual(find(res, 'governance.card.depthIdentity').status, 'failed')
  })
})

// ---------------------------------------------------------------------------
// Discovery level
// ---------------------------------------------------------------------------

describe('discovery level', () => {
  it('health endpoint → returns protocol version', async () => {
    const res = await discoveryLevel(
      ctx({
        http(method, path) {
          if (path === '/health') return okJson({ ok: true, protocolVersion: '1.0' })
          if (path === '/handshake')
            return okJson({ supported: true, protocolVersion: '1.0', lexicon: [] })
          if (path === '/lexicon') return okJson([])
          return { status: 404, headers: new Headers(), json: {}, text: '' }
        },
      }),
    )
    deepStrictEqual(find(res, 'discovery.health').status, 'passed')
  })

  it('handshake accept → protocol version match', async () => {
    const res = await discoveryLevel(
      ctx({
        http(method, path) {
          if (path === '/handshake')
            return okJson({ supported: true, protocolVersion: '1.0', lexicon: [] })
          if (path === '/health') return okJson({ ok: true, protocolVersion: '1.0' })
          if (path === '/lexicon') return okJson([])
          return { status: 404, headers: new Headers(), json: {}, text: '' }
        },
      }),
    )
    deepStrictEqual(find(res, 'discovery.handshake.accept').status, 'passed')
  })

  it('handshake reject → version mismatch', async () => {
    const res = await discoveryLevel(
      ctx({
        http(method, path) {
          if (path === '/handshake' && method === 'POST') {
            // Accept on supported version, reject on bogus
            return okJson({ supported: true, protocolVersion: '1.0', lexicon: [] })
          }
          if (path === '/health') return okJson({ ok: true, protocolVersion: '1.0' })
          if (path === '/lexicon') return okJson([])
          return { status: 404, headers: new Headers(), json: {}, text: '' }
        },
      }),
    )
    deepStrictEqual(find(res, 'discovery.handshake.reject').status, 'failed')
  })

  it('lexicon populated → card checks run', async () => {
    const echo = 'echo'
    const res = await discoveryLevel(
      ctx({
        http(method, path, body) {
          if (path === '/health') return okJson({ ok: true, protocolVersion: '1.0' })
          if (path === '/handshake')
            return okJson({ supported: true, protocolVersion: '1.0', lexicon: [] })
          if (path === '/lexicon')
            return okJson([{ name: echo, intent: 'Echo test', riskTier: 'safe' }])
          if (path.includes(echo)) {
            return okJson({
              name: echo,
              glyphId: 'aa'.repeat(32),
              publicKey: 'bb'.repeat(32),
              intent: 'Echo',
              riskTier: 'safe',
              input: {},
              output: {},
              signature: 'cc'.repeat(64),
            })
          }
          return { status: 404, headers: new Headers(), json: {}, text: '' }
        },
      }),
    )
    // Card shape and signature should be checked
    const cardShape = res.find((c) => c.name === 'discovery.card.shape')
    ok(cardShape, 'card shape check should exist')
    deepStrictEqual(cardShape.status, 'passed')
  })

  it('not found glyph → 404', async () => {
    const res = await discoveryLevel(
      ctx({
        http(method, path) {
          if (path === '/health') return okJson({ ok: true, protocolVersion: '1.0' })
          if (path === '/handshake')
            return okJson({
              supported: true,
              protocolVersion: '1.0',
              lexicon: [{ name: 'exists', intent: 'test', riskTier: 'safe' }],
            })
          if (path === '/lexicon')
            return okJson([{ name: 'exists', intent: 'test', riskTier: 'safe' }])
          if (path.includes('exists')) {
            return okJson({
              id: 'ee'.repeat(32),
              name: 'exists',
              publicKey: 'bb'.repeat(32),
              intent: 'Test',
              riskTier: 'safe',
              input: {},
              output: {},
              signature: 'cc'.repeat(64),
            })
          }
          if (path.includes('__conformance_unknown__')) return glyphErr(404, 'NOT_FOUND')
          return { status: 404, headers: new Headers(), json: {}, text: '' }
        },
      }),
    )
    const notFound = res.find((c) => c.name === 'discovery.error.notFound')
    ok(notFound, 'not found check should exist')
    deepStrictEqual(notFound.status, 'passed')
  })

  it('depth=bogus → 400 validation failed', async () => {
    const echo = 'echo'
    const res = await discoveryLevel(
      ctx({
        http(method, path) {
          if (path === '/health') return okJson({ ok: true, protocolVersion: '1.0' })
          if (path === '/handshake')
            return okJson({
              supported: true,
              protocolVersion: '1.0',
              lexicon: [{ name: echo, intent: 'Echo', riskTier: 'safe' }],
            })
          if (path === '/lexicon') return okJson([{ name: echo, intent: 'Echo', riskTier: 'safe' }])
          if (path.includes('?depth=')) return glyphErr(400, 'VALIDATION_FAILED')
          if (path.includes(echo)) {
            return okJson({
              id: 'ee'.repeat(32),
              name: echo,
              publicKey: 'bb'.repeat(32),
              intent: 'Echo',
              riskTier: 'safe',
              input: {},
              output: {},
              signature: 'cc'.repeat(64),
            })
          }
          return { status: 404, headers: new Headers(), json: {}, text: '' }
        },
      }),
    )
    const depthCheck = res.find((c) => c.name === 'discovery.card.depthEnum')
    ok(depthCheck, 'depth enum check should exist')
    deepStrictEqual(depthCheck.status, 'passed')
  })

  it('schema sanitization check → passes', async () => {
    const res = await discoveryLevel(
      ctx({
        http(method, path) {
          if (path === '/health') return okJson({ ok: true, protocolVersion: '1.0' })
          if (path === '/handshake')
            return okJson({ supported: true, protocolVersion: '1.0', lexicon: [] })
          if (path === '/lexicon') return okJson([])
          return { status: 404, headers: new Headers(), json: {}, text: '' }
        },
      }),
    )
    const schemaCheck = res.find((c) => c.name === 'discovery.schema.sanitization')
    ok(schemaCheck, 'schema sanitization check should exist')
    deepStrictEqual(schemaCheck.status, 'passed')
  })
})

// Execution catch block tests
it('execution call throws → all checks fail', async () => {
  const echo = 'my-echo'
  const res = await executionLevel(
    ctx({
      fixtures: { echo },
      lexiconNames: [echo],
      http() {
        throw new Error('connection refused')
      },
    }),
  )
  for (const c of [
    'execution.call.success',
    'execution.call.envelope',
    'execution.call.receipt',
    'execution.call.sanitization',
  ]) {
    deepStrictEqual(find(res, c).status, 'failed')
  }
})

it('execution output validation throws → catch path', async () => {
  const echo = 'echo'
  const bad = 'bad-output'
  let call = 0
  const res = await executionLevel(
    ctx({
      fixtures: { echo, invalidOutput: bad },
      lexiconNames: [echo, bad],
      http(method, path) {
        call++
        if (call <= 3)
          return okJson({
            type: 'data',
            payload: { value: 'hello' },
            receipt: { glyphId: 'abc', callId: '123', signature: 'sig' },
            inspection: { findings: [] },
          })
        if (call === 4) return glyphErr(400, 'VALIDATION_FAILED')
        if (call === 5) return glyphErr(400, 'MALFORMED_JSON')
        throw new Error('output validation crashed')
      },
    }),
  )
  deepStrictEqual(find(res, 'execution.call.outputValidation').status, 'failed')
})

// Security catch block tests
it('security confirmation bogus token throws → catch path', async () => {
  const reqConf = 'danger-tool'
  const res = await securityLevel(
    ctx({
      fixtures: { requiresConfirmation: reqConf },
      lexiconNames: [reqConf],
      http(method, path) {
        if (path.includes(reqConf)) throw new Error('server crash')
        return okJson({})
      },
    }),
  )
  deepStrictEqual(find(res, 'security.confirmation.required').status, 'failed')
})

it('security timeout catch error → reports failure', async () => {
  const slow = 'slow-tool'
  const res = await securityLevel(
    ctx({
      fixtures: { slow },
      lexiconNames: [slow],
      http() {
        throw new Error('timeout check failed')
      },
    }),
  )
  deepStrictEqual(find(res, 'security.timeout').status, 'failed')
})

it('security rateLimit throws → catch path', async () => {
  const echo = 'echo'
  const res = await securityLevel(
    ctx({
      fixtures: { echo },
      lexiconNames: [echo],
      http() {
        throw new Error('burst overflow')
      },
    }),
  )
  deepStrictEqual(find(res, 'security.rateLimit').status, 'failed')
})
