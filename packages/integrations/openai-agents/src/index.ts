import type { GlyphClient } from '@glyphp/client'
import type { GlyphCard, LexiconEntry } from '@glyphp/types'

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
    confirmationToken: string
  }) => Promise<boolean>
}

export async function glyphsAsOpenAiAgentTools(
  client: GlyphClient,
  options: GlyphsAsOpenAiAgentToolsOptions = {}
): Promise<OpenAiAgentTool[]> {
  const lexicon = await client.getLexicon()
  const tools: OpenAiAgentTool[] = []
  for (const entry of lexicon) {
    tools.push(await buildTool(client, entry, options))
  }
  return tools
}

/**
 * Synchronous low-fidelity helper — emits tools with empty parameter
 * schemas. Prefer `glyphsAsOpenAiAgentTools`.
 */
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

async function buildTool(
  client: GlyphClient,
  entry: LexiconEntry,
  options: GlyphsAsOpenAiAgentToolsOptions
): Promise<OpenAiAgentTool> {
  let parameters: unknown = { type: 'object', properties: {} }
  try {
    const card: GlyphCard = await client.getCard(entry.name, 'rich')
    if (card.input) parameters = card.input
  } catch (err) {
    console.warn(
      `[@glyphp/integration-openai-agents] could not fetch card for "${entry.name}"; LLM will receive raw JSON. ${(err as Error).message ?? err}`
    )
  }
  return {
    name: entry.name,
    description: entry.intent,
    parameters,
    execute: makeExecute(client, entry.name, options),
  }
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
        const approved = options.onConfirmation
          ? await options.onConfirmation({
              glyphName: name,
              cost: ticket.cost,
              input,
              confirmationToken: ticket.confirmationToken,
            })
          : false
        if (approved !== true) throw err
        return client.call(name, input, { confirmationToken: ticket.confirmationToken })
      }
      throw err
    })
    return (envelope as { payload: unknown }).payload
  }
}
