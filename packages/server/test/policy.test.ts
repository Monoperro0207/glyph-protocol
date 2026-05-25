/**
 * RFC-0002 — scope-based policy gate on the server.
 *
 * The glyph carries `requiredScopes`; the server is configured with a
 * `policy` resolver that turns a request into a `CallerPrincipal` carrying
 * scopes (and an optional tenant). The handler runs only when the caller
 * has every required scope.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { z } from 'zod'
import type { PolicyResolver } from '../src/index.js'
import { defineGlyph, GlyphServer } from '../src/index.js'

const SCOPED = defineGlyph({
  name: 'reports.read',
  intent: 'Read a report — requires the reports:read scope',
  cost: {
    latency: 'fast',
    sideEffects: false,
    reversible: true,
    riskTier: 'safe',
    requiresConfirmation: false,
  },
  input: z.object({}),
  output: z.object({ ok: z.literal(true) }),
  provider: 'test',
  requiredScopes: ['reports:read'],
  handler: async () => ({ ok: true as const }),
})

const OPEN = defineGlyph({
  name: 'ping',
  intent: 'Open glyph with no scopes',
  cost: {
    latency: 'fast',
    sideEffects: false,
    reversible: true,
    riskTier: 'safe',
    requiresConfirmation: false,
  },
  input: z.object({}),
  output: z.object({ ok: z.boolean() }),
  provider: 'test',
  handler: async () => ({ ok: true }),
})

function call(token?: string) {
  return new Request('http://glyph/glyphs/reports.read/call', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ input: {} }),
  })
}

function callOpen() {
  return new Request('http://glyph/glyphs/ping/call', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ input: {} }),
  })
}

const resolveByToken: PolicyResolver = (c) => {
  const header = c.req.header('Authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (token === 'reader') return { id: 'u1', scopes: ['reports:read'], tenant: 't1' }
  if (token === 'reader-t2') return { id: 'u2', scopes: ['reports:read'], tenant: 't2' }
  if (token === 'admin') return { id: 'u3', scopes: ['reports:read', 'reports:write'] }
  if (token === 'wrong') return { id: 'u4', scopes: ['other:scope'] }
  return undefined
}

test('a glyph without requiredScopes runs even when policy is configured (back-compat)', async () => {
  const server = new GlyphServer({ policy: resolveByToken })
  server.register(OPEN)
  const r = await server.fetch(callOpen())
  assert.equal(r.status, 200)
})

test('caller with the required scope succeeds', async () => {
  const server = new GlyphServer({ policy: resolveByToken })
  server.register(SCOPED)
  const r = await server.fetch(call('reader'))
  assert.equal(r.status, 200)
  const body = (await r.json()) as { payload: { ok: boolean } }
  assert.equal(body.payload.ok, true)
})

test('caller with the wrong scopes gets 403 INSUFFICIENT_SCOPE with the missing list', async () => {
  const server = new GlyphServer({ policy: resolveByToken })
  server.register(SCOPED)
  const r = await server.fetch(call('wrong'))
  assert.equal(r.status, 403)
  const body = (await r.json()) as { error: { code: string; details: { missing: string[] } } }
  assert.equal(body.error.code, 'INSUFFICIENT_SCOPE')
  assert.deepEqual(body.error.details.missing, ['reports:read'])
})

test('caller with no principal (no policy configured) is rejected from a scoped glyph', async () => {
  const server = new GlyphServer() // no policy resolver
  server.register(SCOPED)
  const r = await server.fetch(call())
  assert.equal(r.status, 403)
  const body = (await r.json()) as { error: { code: string } }
  assert.equal(body.error.code, 'INSUFFICIENT_SCOPE')
})

test('different tenants both authorize when they carry the scope', async () => {
  const server = new GlyphServer({ policy: resolveByToken })
  server.register(SCOPED)
  const a = await server.fetch(call('reader'))
  const b = await server.fetch(call('reader-t2'))
  assert.equal(a.status, 200)
  assert.equal(b.status, 200)
})

test('requiredScopes is part of the canonical card id', async () => {
  // Two otherwise-identical glyphs must produce different ids when their
  // scope requirements differ — this is what makes a policy change a
  // breaking card change (consumer must re-approve).
  const sameAsScoped = defineGlyph({
    name: 'reports.read',
    intent: SCOPED.card.intent,
    cost: SCOPED.card.cost,
    input: z.object({}),
    output: z.object({ ok: z.literal(true) }),
    provider: SCOPED.card.provider,
    requiredScopes: ['reports:write'], // different scopes
    handler: async () => ({ ok: true as const }),
  })
  assert.notEqual(SCOPED.card.id, sameAsScoped.card.id)
})
