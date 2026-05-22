import { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { computeGlyphId } from '@glyph-protocol/core'
import type { GlyphCard } from '@glyph-protocol/types'

export interface GlyphDefinition<TInput, TOutput> {
  card: GlyphCard
  inputSchema: z.ZodType<TInput>
  outputSchema: z.ZodType<TOutput>
  handler: (input: TInput) => Promise<TOutput>
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
  handler: (input: TInput) => Promise<TOutput>
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
