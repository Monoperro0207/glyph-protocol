import assert from 'node:assert/strict'
import { test, describe } from 'node:test'
import { glyphsFromOpenApi, redactUrl } from '../src/index.js'
import type { OpenApiDoc } from '../src/openapi-types.js'

// ── Task 1: Handler-level integration test ──────────────────────────────

test('API key in query string is redacted from HTTP error messages', async () => {
  const secDoc: OpenApiDoc = {
    openapi: '3.0.0',
    info: { title: 't', version: '1' },
    components: {
      securitySchemes: {
        apiKeyQuery: { type: 'apiKey', in: 'query', name: 'api_key' },
      },
    },
    security: [{ apiKeyQuery: [] }],
    paths: {
      '/secret-endpoint': {
        get: {
          operationId: 'secretEndpoint',
          responses: { '200': { description: 'ok' } },
        },
      },
    },
  }
  const [glyph] = glyphsFromOpenApi(secDoc, {
    baseUrl: 'https://x.test',
    security: { schemes: { apiKeyQuery: { type: 'apiKey', value: 'sk-12345-secret' } } },
  })

  const realFetch = globalThis.fetch
  globalThis.fetch = (async () => ({
    ok: false,
    status: 500,
    text: async () => 'Internal Server Error',
  })) as unknown as typeof fetch
  try {
    let thrown: Error | null = null
    try {
      await glyph.handler({})
    } catch (err) {
      thrown = err as Error
    }
    assert.ok(thrown, 'Expected handler to throw on HTTP 500')
    assert.match(thrown!.message, /HTTP 500/)
    assert.ok(
      !thrown!.message.includes('sk-12345-secret'),
      `Error message leaked API key: ${thrown!.message}`,
    )
  } finally {
    globalThis.fetch = realFetch
  }
})

// ── Task 4: URL without secrets stays unchanged ──────────────────────────

test('URL without secrets stays unchanged', () => {
  const url = 'https://api.example.com/pets?limit=10&sort=asc'
  assert.equal(redactUrl(url), url)
})

test('URL without query string stays unchanged', () => {
  const url = 'https://api.example.com/pets'
  assert.equal(redactUrl(url), url)
})

// ── Task 5: Multiple secrets in one URL, all redacted ────────────────────

test('multiple secrets in one URL are all redacted', () => {
  const url = 'https://api.example.com/search?q=test&api_key=abc123&token=xyz789&sort=asc'
  const result = redactUrl(url)
  assert.ok(result.includes('api_key=***'), `Expected api_key=*** in: ${result}`)
  assert.ok(result.includes('token=***'), `Expected token=*** in: ${result}`)
  assert.ok(!result.includes('abc123'), `Secret value abc123 leaked in: ${result}`)
  assert.ok(!result.includes('xyz789'), `Secret value xyz789 leaked in: ${result}`)
  // Non-sensitive params are preserved
  assert.ok(result.includes('q=test'))
  assert.ok(result.includes('sort=asc'))
})

test('single secret is redacted while preserving other params', () => {
  const result = redactUrl('https://x.test/api?access_token=ghp_secret123&page=1')
  assert.ok(result.includes('access_token=***'))
  assert.ok(!result.includes('ghp_secret123'))
  assert.ok(result.includes('page=1'))
})

// ── Task 6: OpenAPI security scheme parameter name is also redacted ──────

test('OpenAPI security scheme parameter name in query position is redacted', () => {
  const url = 'https://api.example.com/data?x-api-token=secret123&limit=5'
  // 'x-api-token' is a security scheme param name passed as extraSensitive
  const result = redactUrl(url, ['x-api-token'])
  assert.ok(result.includes('x-api-token=***'), `Expected x-api-token=*** in: ${result}`)
  assert.ok(!result.includes('secret123'), `Secret value secret123 leaked in: ${result}`)
  assert.ok(result.includes('limit=5'))
})

// ── Triangulation: edge cases ────────────────────────────────────────────

test('case-insensitive matching of built-in sensitive params', () => {
  const result = redactUrl('https://x.test/api?API_KEY=val1&ApiKey=val2&TOKEN=val3')
  assert.ok(result.includes('API_KEY=***'))
  assert.ok(result.includes('ApiKey=***'))
  assert.ok(result.includes('TOKEN=***'))
  assert.ok(!result.includes('val1'))
  assert.ok(!result.includes('val2'))
  assert.ok(!result.includes('val3'))
})

test('url with only secret params redacts all', () => {
  const result = redactUrl('https://x.test/api?secret=abc&key=def')
  assert.ok(result.includes('secret=***'))
  assert.ok(result.includes('key=***'))
  assert.ok(!result.includes('abc'))
  assert.ok(!result.includes('def'))
})

test('password param is redacted', () => {
  const result = redactUrl('https://x.test/login?password=hunter2&user=admin')
  assert.ok(result.includes('password=***'))
  assert.ok(!result.includes('hunter2'))
  assert.ok(result.includes('user=admin'))
})

test('authorization param is redacted', () => {
  const result = redactUrl('https://x.test/callback?authorization=Bearer+tok&state=abc')
  assert.ok(result.includes('authorization=***'))
  assert.ok(!result.includes('Bearer'))
  assert.ok(result.includes('state=abc'))
})
