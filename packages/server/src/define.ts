import { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { computeGlyphId } from '@glyphp/core'
import type { GlyphCard } from '@glyphp/types'

/**
 * Runtime context handed to a glyph handler. `signal` aborts when the call
 * exceeds the server's timeout — a cooperating handler should forward it to
 * `fetch`/child processes so a timed-out call stops doing real work. A handler
 * that ignores it still works; the server just cannot cancel it.
 */
export interface GlyphHandlerContext {
  signal: AbortSignal
}

export interface GlyphDefinition<TInput, TOutput> {
  card: GlyphCard
  inputSchema: z.ZodType<TInput>
  outputSchema: z.ZodType<TOutput>
  handler: (input: TInput, ctx?: GlyphHandlerContext) => Promise<TOutput>
}

export function defineGlyph<TInput, TOutput>(config: {
  name: string
  intent: string
  tags?: string[]
  cost: GlyphCard['cost']
  idempotent?: boolean
  input: z.ZodType<TInput>
  output: z.ZodType<TOutput>
  examples?: GlyphCard['examples']
  failureModes?: GlyphCard['failureModes']
  provider: string
  /**
   * Optional scopes that the caller must present to invoke this glyph. When
   * non-empty, the server enforces every listed scope before executing.
   * Omit entirely (or pass an empty array → omitted at canonicalize time)
   * to leave the glyph open to any authenticated caller.
   * See `spec/rfcs/RFC-0002-policy-layer.md`.
   */
  requiredScopes?: string[]
  handler: (input: TInput, ctx?: GlyphHandlerContext) => Promise<TOutput>
}): GlyphDefinition<TInput, TOutput> {
  // An empty array would change the card id and feel weird; treat it as
  // "no scopes declared" so the canonical content omits the field.
  const scopes = config.requiredScopes && config.requiredScopes.length > 0
    ? [...config.requiredScopes]
    : undefined
  const partial: Omit<GlyphCard, 'id' | 'signature' | 'createdAt' | 'publicKey'> = {
    version: '1.0.0',
    name: config.name,
    intent: config.intent,
    tags: config.tags ?? [],
    cost: config.cost,
    idempotent: config.idempotent ?? false,
    input: zodToJsonSchema(config.input) as Record<string, unknown>,
    output: zodToJsonSchema(config.output) as Record<string, unknown>,
    examples: config.examples ?? [],
    failureModes: config.failureModes ?? [],
    provider: config.provider,
    ...(scopes ? { requiredScopes: scopes } : {}),
  }

  const id = computeGlyphId(partial)
  const card: GlyphCard = { ...partial, id, createdAt: new Date().toISOString() }

  // The card is left unsigned here — the GlyphServer signs it at register()
  // time with the provider's keypair.
  return {
    card,
    inputSchema: config.input,
    outputSchema: config.output,
    handler: config.handler,
  }
}
