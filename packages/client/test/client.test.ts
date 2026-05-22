import { test } from 'node:test'
import assert from 'node:assert/strict'
import { GlyphClient } from '../src/index.js'

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    headers: { 'content-type': 'application/json' },
  })
}

/** A fetch stub that records the last Request it was handed. */
function recorder(data: unknown = []): {
  fetch: typeof fetch
  last: () => Request
} {
  let seen: Request | undefined
  const fetchImpl: typeof fetch = async (input) => {
    seen = input as Request
    return jsonResponse(data)
  }
  return {
    fetch: fetchImpl,
    last: () => {
      if (!seen) throw new Error('fetch was never called')
      return seen
    },
  }
}

test('GlyphClient sends the bearer token on every request', async () => {
  const rec = recorder()
  const client = new GlyphClient({
    baseUrl: 'http://glyph',
    authToken: 's3cret',
    fetch: rec.fetch,
  })
  await client.getLexicon()
  assert.equal(rec.last().headers.get('Authorization'), 'Bearer s3cret')
})

test('GlyphClient omits Authorization when no token is set', async () => {
  const rec = recorder()
  const client = new GlyphClient({ baseUrl: 'http://glyph', fetch: rec.fetch })
  await client.getLexicon()
  assert.equal(rec.last().headers.get('Authorization'), null)
})

test('GlyphClient merges custom headers into requests', async () => {
  const rec = recorder()
  const client = new GlyphClient({
    baseUrl: 'http://glyph',
    headers: { 'X-Trace': 'abc' },
    fetch: rec.fetch,
  })
  await client.getLexicon()
  assert.equal(rec.last().headers.get('X-Trace'), 'abc')
})

test('GlyphClient percent-encodes the glyph name in the path', async () => {
  const rec = recorder({})
  const client = new GlyphClient({ baseUrl: 'http://glyph', fetch: rec.fetch })
  await client.getCard('weird/name with spaces')
  assert.ok(
    rec.last().url.endsWith('/glyphs/weird%2Fname%20with%20spaces'),
    `unexpected url: ${rec.last().url}`
  )
})

test('GlyphClient sends the auth token on a glyph call too', async () => {
  const rec = recorder({ type: 'data', payload: {} })
  const client = new GlyphClient({
    baseUrl: 'http://glyph',
    authToken: 'tok',
    fetch: rec.fetch,
  })
  await client.call('greet', { name: 'Ada' })
  const req = rec.last()
  assert.equal(req.headers.get('Authorization'), 'Bearer tok')
  assert.equal(req.headers.get('Content-Type'), 'application/json')
})
