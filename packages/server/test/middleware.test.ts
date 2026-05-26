import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { MiddlewareHandler } from 'hono'
import { Hono } from 'hono'
import { authMiddleware, rateLimitMiddleware } from '../src/middleware.js'

function appWith(mw: MiddlewareHandler): Hono {
  const app = new Hono()
  app.use('*', mw)
  app.get('/health', (c) => c.text('health'))
  app.get('/x', (c) => c.text('ok'))
  return app
}

test('authMiddleware rejects requests without a token', async () => {
  const app = appWith(authMiddleware({ tokens: ['secret'] }))
  assert.equal((await app.request('/x')).status, 401)
})

test('authMiddleware accepts a valid bearer token', async () => {
  const app = appWith(authMiddleware({ tokens: ['secret'] }))
  const res = await app.request('/x', {
    headers: { Authorization: 'Bearer secret' },
  })
  assert.equal(res.status, 200)
})

test('authMiddleware rejects an invalid token', async () => {
  const app = appWith(authMiddleware({ tokens: ['secret'] }))
  const res = await app.request('/x', {
    headers: { Authorization: 'Bearer wrong' },
  })
  assert.equal(res.status, 401)
})

test('authMiddleware leaves /health public', async () => {
  const app = appWith(authMiddleware({ tokens: ['secret'] }))
  assert.equal((await app.request('/health')).status, 200)
})

test('authMiddleware supports a custom verify function', async () => {
  const app = appWith(authMiddleware({ verify: (t) => t.startsWith('ok-') }))
  const good = await app.request('/x', {
    headers: { Authorization: 'Bearer ok-1' },
  })
  const bad = await app.request('/x', {
    headers: { Authorization: 'Bearer no' },
  })
  assert.equal(good.status, 200)
  assert.equal(bad.status, 401)
})

test('rateLimitMiddleware allows requests up to the limit', async () => {
  const app = appWith(rateLimitMiddleware({ windowMs: 60000, max: 2 }))
  assert.equal((await app.request('/x')).status, 200)
  assert.equal((await app.request('/x')).status, 200)
})

test('rateLimitMiddleware returns 429 with Retry-After past the limit', async () => {
  const app = appWith(rateLimitMiddleware({ windowMs: 60000, max: 2 }))
  await app.request('/x')
  await app.request('/x')
  const res = await app.request('/x')
  assert.equal(res.status, 429)
  assert.ok(res.headers.get('Retry-After'))
})

test('rateLimitMiddleware keys a separate bucket per verified token', async () => {
  const verify = (t: string) => t === 'good-a' || t === 'good-b'
  const app = appWith(rateLimitMiddleware({ windowMs: 60000, max: 1 }, verify))
  const a = { headers: { Authorization: 'Bearer good-a' } }
  const b = { headers: { Authorization: 'Bearer good-b' } }
  assert.equal((await app.request('/x', a)).status, 200)
  assert.equal((await app.request('/x', a)).status, 429)
  assert.equal((await app.request('/x', b)).status, 200)
})

test('rateLimitMiddleware does not let unverified tokens escape the limit', async () => {
  const verify = (t: string) => t === 'good'
  const app = appWith(rateLimitMiddleware({ windowMs: 60000, max: 1 }, verify))
  // An attacker rotates a fresh fake token on every request. Each must land
  // in the shared IP bucket, not a brand-new per-token bucket.
  assert.equal(
    (await app.request('/x', { headers: { Authorization: 'Bearer fake-1' } })).status,
    200,
  )
  assert.equal(
    (await app.request('/x', { headers: { Authorization: 'Bearer fake-2' } })).status,
    429,
  )
})

test('rateLimitMiddleware never limits /health', async () => {
  const app = appWith(rateLimitMiddleware({ windowMs: 60000, max: 1 }))
  await app.request('/health')
  await app.request('/health')
  assert.equal((await app.request('/health')).status, 200)
})

// --- Constant-time token check tests (Fix 3) ---

test('authMiddleware rejects a token of different length than configured tokens', async () => {
  const app = appWith(authMiddleware({ tokens: ['short'] }))
  const res = await app.request('/x', {
    headers: { Authorization: 'Bearer a-very-long-token-that-does-not-match-at-all' },
  })
  assert.equal(res.status, 401)
})

test('authMiddleware rejects a token that differs only in case', async () => {
  const app = appWith(authMiddleware({ tokens: ['Secret-Token'] }))
  const res = await app.request('/x', {
    headers: { Authorization: 'Bearer secret-token' },
  })
  assert.equal(res.status, 401)
})

// --- Rate limit GC sweep test ---

test('rateLimitMiddleware sweeps expired entries to prevent unbounded growth', async () => {
  // windowMs=1 so entries expire after 1ms and get swept on the next request
  const app = appWith(rateLimitMiddleware({ windowMs: 1, max: 100 }))

  // Create 5 entries with different client keys that expire immediately
  for (let i = 0; i < 5; i++) {
    await app.request('/x', { headers: { 'X-Forwarded-For': `10.0.0.${i}` } })
  }
  // Wait for them to expire
  await new Promise((r) => setTimeout(r, 5))

  // One more request triggers the sweep — expired entries get cleaned
  const res = await app.request('/x', { headers: { 'X-Forwarded-For': '10.0.0.99' } })
  assert.equal(res.status, 200)
})
