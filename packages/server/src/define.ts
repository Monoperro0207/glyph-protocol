import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { computeGlyphId, signGlyph } from '@glyph/core'
import type { GlyphCard } from '@glyph/types'

export interface GlyphDefinition<TInput, TOutput> {
  card: GlyphCard
  inputSchema: z.ZodType<TInput>
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
  const createdAt = new Date().toISOString()
  const cardWithoutSig: GlyphCard = { ...partial, id, createdAt }
  const signature = signGlyph(cardWithoutSig)

  return {
    card: { ...cardWithoutSig, signature },
    inputSchema: config.input,
    handler: config.handler,
  }
}
