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
  handler: (input: TInput, ctx?: GlyphHandlerContext) => Promise<TOutput>
}): GlyphDefinition<TInput, TOutput> {
  const partial = {
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
