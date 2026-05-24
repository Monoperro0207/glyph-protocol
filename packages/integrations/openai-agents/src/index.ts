import type { GlyphClient } from '@glyphp/client'
import type { LexiconEntry } from '@glyphp/types'

/**
 * Duck-typed shape compatible with the OpenAI Agents SDK's `tool({...})`
 * factory. Avoids a hard runtime dep on `@openai/agents`.
 */
export interface OpenAiAgentTool {
  name: string
  description: string
  parameters: unknown
  execute: (input: Record<string, unknown>) => Promise<unknown>
}

export interface GlyphsAsOpenAiAgentToolsOptions {
  onConfirmation?: (ticket: {
    glyphName: string
    cost: unknown
    input: unknown
  }) => Promise<string | undefined>
}

export async function glyphsAsOpenAiAgentTools(
  client: GlyphClient,
  options: GlyphsAsOpenAiAgentToolsOptions = {}
): Promise<OpenAiAgentTool[]> {
  const lexicon = await client.getLexicon()
  return fromLexicon(client, lexicon, options)
}

export function fromLexicon(
  client: GlyphClient,
  lexicon: LexiconEntry[],
  options: GlyphsAsOpenAiAgentToolsOptions = {}
): OpenAiAgentTool[] {
  return lexicon.map((entry) => ({
    name: entry.name,
    description: entry.intent,
    parameters: { type: 'object', properties: {} },
    execute: makeExecute(client, entry.name, options),
  }))
}

function makeExecute(
  client: GlyphClient,
  name: string,
  options: GlyphsAsOpenAiAgentToolsOptions
): OpenAiAgentTool['execute'] {
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
