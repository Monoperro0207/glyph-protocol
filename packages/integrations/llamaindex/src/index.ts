import type { GlyphClient } from '@glyphp/client'
import type { LexiconEntry } from '@glyphp/types'

/**
 * Duck-typed shape that LlamaIndex.TS's `FunctionTool.from({...})` accepts —
 * the integration emits these plain objects so this package does not depend
 * on `llamaindex` at runtime.
 */
export interface LlamaIndexGlyphTool {
  name: string
  description: string
  parameters: { type: 'object'; properties: Record<string, unknown> }
  fn: (input: Record<string, unknown>) => Promise<unknown>
}

export interface GlyphsAsLlamaIndexToolsOptions {
  onConfirmation?: (ticket: {
    glyphName: string
    cost: unknown
    input: unknown
  }) => Promise<string | undefined>
}

export async function glyphsAsLlamaIndexTools(
  client: GlyphClient,
  options: GlyphsAsLlamaIndexToolsOptions = {}
): Promise<LlamaIndexGlyphTool[]> {
  const lexicon = await client.getLexicon()
  return fromLexicon(client, lexicon, options)
}

export function fromLexicon(
  client: GlyphClient,
  lexicon: LexiconEntry[],
  options: GlyphsAsLlamaIndexToolsOptions = {}
): LlamaIndexGlyphTool[] {
  return lexicon.map((entry) => ({
    name: entry.name,
    description: entry.intent,
    parameters: { type: 'object', properties: {} },
    fn: makeFn(client, entry.name, options),
  }))
}

function makeFn(
  client: GlyphClient,
  name: string,
  options: GlyphsAsLlamaIndexToolsOptions
): LlamaIndexGlyphTool['fn'] {
  return async (input) => {
    const envelope = await client.call(name, input).catch(async (err) => {
      if (
        err &&
        typeof err === 'object' &&
        'code' in err &&
        (err as { code: unknown }).code === 'CONFIRMATION_REQUIRED'
      ) {
        const ticket = await client.prepare(name, input)
        const token = options.onConfirmation
          ? await options.onConfirmation({
              glyphName: name,
              cost: ticket.cost,
              input,
            })
          : undefined
        if (!token) throw err
        return client.call(name, input, { confirmationToken: ticket.confirmationToken })
      }
      throw err
    })
    return (envelope as { payload: unknown }).payload
  }
}
