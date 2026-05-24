import { z } from 'zod'
import { defineGlyph, GlyphServer } from '@glyphp/server'
import type { GlyphDefinition } from '@glyphp/server'
import type { FixtureGlyphs } from './types.js'

/**
 * The names a server is expected to use when exposing the conformance fixture
 * glyphs. Reserved under the `conformance-` prefix so they cannot collide
 * with a real tool. Servers may publish a subset; missing fixtures cause the
 * corresponding checks to be skipped, not failed.
 */
export const FIXTURE_NAMES: Required<FixtureGlyphs> = {
  echo: 'conformance-echo',
  requiresConfirmation: 'conformance-requires-confirmation',
  slow: 'conformance-slow',
  invalidOutput: 'conformance-invalid-output',
}

/**
 * Builds the four standard conformance fixture glyphs. A server-under-test
 * can register a subset; the suite skips the level checks that depend on
 * fixtures it cannot find in the lexicon.
 */
export function buildFixtureGlyphs(): GlyphDefinition<any, any>[] {
  const echo = defineGlyph({
    name: FIXTURE_NAMES.echo,
    intent: 'Echoes its input — safe round-trip fixture',
    cost: {
      latency: 'fast',
      sideEffects: false,
      reversible: true,
      riskTier: 'safe',
      requiresConfirmation: false,
    },
    input: z.object({ value: z.string() }),
    output: z.object({ value: z.string() }),
    provider: 'conformance',
    handler: async (input) => input,
  })

  const requiresConfirmation = defineGlyph({
    name: FIXTURE_NAMES.requiresConfirmation,
    intent: 'Always requires confirmation — exercises the security gate',
    cost: {
      latency: 'fast',
      sideEffects: true,
      reversible: false,
      riskTier: 'danger',
      requiresConfirmation: true,
    },
    input: z.object({}).passthrough(),
    output: z.object({ ok: z.boolean() }),
    provider: 'conformance',
    handler: async () => ({ ok: true }),
  })

  const slow = defineGlyph({
    name: FIXTURE_NAMES.slow,
    intent: 'Exceeds the server timeout — exercises HANDLER_TIMEOUT',
    cost: {
      latency: 'slow',
      sideEffects: false,
      reversible: true,
      riskTier: 'safe',
      requiresConfirmation: false,
    },
    input: z.object({}).passthrough(),
    output: z.object({ ok: z.boolean() }),
    provider: 'conformance',
    handler: async (_input, ctx) =>
      new Promise((resolve, reject) => {
        const t = setTimeout(() => resolve({ ok: true }), 60_000)
        ctx?.signal?.addEventListener('abort', () => {
          clearTimeout(t)
          reject(new Error('aborted'))
        })
      }),
  })

  const invalidOutput = defineGlyph({
    name: FIXTURE_NAMES.invalidOutput,
    intent: 'Returns output that fails the declared schema',
    cost: {
      latency: 'fast',
      sideEffects: false,
      reversible: true,
      riskTier: 'safe',
      requiresConfirmation: false,
    },
    input: z.object({}).passthrough(),
    output: z.object({ ok: z.boolean(), count: z.number().int() }),
    provider: 'conformance',
    // Deliberately violates the output schema: count is a string.
    handler: async () =>
      ({ ok: 'not-a-boolean', count: 'three' } as unknown as {
        ok: boolean
        count: number
      }),
  })

  return [echo, requiresConfirmation, slow, invalidOutput]
}

/**
 * Convenience: register all fixtures on an existing server.
 */
export function registerFixtures(server: GlyphServer): GlyphServer {
  for (const glyph of buildFixtureGlyphs()) server.register(glyph)
  return server
}
