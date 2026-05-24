import type { GlyphClient } from '@glyphp/client'
import type { LexiconEntry } from '@glyphp/types'

/**
 * Duck-typed shape matching `@langchain/core`'s `StructuredTool` enough for
 * an agent loop to consume — exposing `name`, `description`, `schema` and
 * an async `invoke(input)`. Avoids a hard runtime dep on langchain.
 */
export interface LangChainGlyphTool {
  name: string
  description: string
  schema: { jsonSchema: unknown }
  invoke(input: Record<string, unknown>): Promise<string>
}

export interface GlyphsAsLangChainToolsOptions {
  onConfirmation?: (ticket: {
    glyphName: string
    cost: unknown
    input: unknown
  }) => Promise<string | undefined>
}

export async function glyphsAsLangChainTools(
  client: GlyphClient,
  options: GlyphsAsLangChainToolsOptions = {}
): Promise<LangChainGlyphTool[]> {
  const lexicon = await client.getLexicon()
  return fromLexicon(client, lexicon, options)
}

export function fromLexicon(
  client: GlyphClient,
  lexicon: LexiconEntry[],
  options: GlyphsAsLangChainToolsOptions = {}
): LangChainGlyphTool[] {
  return lexicon.map((entry) => ({
    name: entry.name,
    description: entry.intent,
    schema: { jsonSchema: {} },
    invoke: makeInvoke(client, entry.name, options),
  }))
}

function makeInvoke(
  client: GlyphClient,
  name: string,
  options: GlyphsAsLangChainToolsOptions
): LangChainGlyphTool['invoke'] {
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
    // LangChain tools conventionally return strings. We JSON-stringify the
    // payload so structured output survives the round trip.
    return JSON.stringify((envelope as { payload: unknown }).payload)
  }
}
