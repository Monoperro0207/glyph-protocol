import assert from 'node:assert/strict'
import { test } from 'node:test'
import { verifyManifest } from '@glyphp/core'
import type { UpdateManifest } from '@glyphp/types'
import { z } from 'zod'
import { defineGlyph, GlyphServer } from '../src/index.js'

function buildServer(): GlyphServer {
  const server = new GlyphServer()
  server.register(
    defineGlyph({
      name: 'greet',
      intent: 'Greets someone',
      cost: {
        latency: 'fast',
        sideEffects: false,
        reversible: true,
        riskTier: 'safe',
        requiresConfirmation: false,
      },
      input: z.object({ name: z.string() }),
      output: z.object({ greeting: z.string() }),
      provider: 'test',
      handler: async () => ({ greeting: 'hi' }),
    }),
  )
  return server
}

async function getManifest(
  server: GlyphServer,
  name: string,
): Promise<{ status: number; body: any }> {
  const res = await server.fetch(new Request(`http://glyph/glyphs/${name}/manifest`))
  return { status: res.status, body: await res.json() }
}

test('GET /glyphs/:name/manifest is 404 before any manifest is registered', async () => {
  const res = await getManifest(buildServer(), 'greet')
  assert.equal(res.status, 404)
  assert.equal(res.body.error.code, 'NOT_FOUND')
})

test('registerManifest publishes a signed, verifiable manifest', async () => {
  const server = buildServer()
  server.registerManifest('greet', {
    previousCardId: 'old-card-id',
    reason: 'Tightened the input schema',
    breaking: true,
    securityImpact: 'low',
  })
  const res = await getManifest(server, 'greet')
  assert.equal(res.status, 200)
  const manifest = res.body as UpdateManifest
  assert.equal(manifest.toolName, 'greet')
  assert.equal(manifest.previousCardId, 'old-card-id')
  assert.equal(manifest.breaking, true)
  assert.equal(manifest.securityImpact, 'low')
  assert.ok(manifest.newCardId, 'newCardId should be filled from the current card')
  assert.equal(verifyManifest(manifest), true)
})

test('registerManifest throws for an unknown glyph', () => {
  assert.throws(
    () =>
      buildServer().registerManifest('nope', {
        previousCardId: 'x',
        reason: 'y',
        breaking: false,
        securityImpact: 'none',
      }),
    /unknown glyph/,
  )
})

test('GET /glyphs/:name/manifest is 404 for an unknown glyph', async () => {
  const res = await getManifest(buildServer(), 'nope')
  assert.equal(res.status, 404)
})
