import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Hono } from 'hono'
import type { MiddlewareHandler } from 'hono'
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

test('rateLimitMiddleware keys a separate bucket per bearer token', async () => {
  const app = appWith(rateLimitMiddleware({ windowMs: 60000, max: 1 }))
  const a = { headers: { Authorization: 'Bearer aaa' } }
  const b = { headers: { Authorization: 'Bearer bbb' } }
  assert.equal((await app.request('/x', a)).status, 200)
  assert.equal((await app.request('/x', a)).status, 429)
  assert.equal((await app.request('/x', b)).status, 200)
})

test('rateLimitMiddleware never limits /health', async () => {
  const app = appWith(rateLimitMiddleware({ windowMs: 60000, max: 1 }))
  await app.request('/health')
  await app.request('/health')
  assert.equal((await app.request('/health')).status, 200)
})
