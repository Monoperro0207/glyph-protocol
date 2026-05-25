import type { GlyphClient } from '@glyphp/client'
import type { GlyphCard, LexiconEntry } from '@glyphp/types'

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
  /**
   * Approval hook invoked when a glyph carries `requiresConfirmation: true`.
   * The hook receives the prepared ticket — including the bound
   * `confirmationToken` — and MUST return `true` to authorize execution.
   * Any other value (including `false`, `undefined`, or a thrown error)
   * re-raises the original `CONFIRMATION_REQUIRED` error.
   */
  onConfirmation?: (ticket: {
    glyphName: string
    cost: unknown
    input: unknown
    confirmationToken: string
  }) => Promise<boolean>
}

export async function glyphsAsLangChainTools(
  client: GlyphClient,
  options: GlyphsAsLangChainToolsOptions = {},
): Promise<LangChainGlyphTool[]> {
  const lexicon = await client.getLexicon()
  const tools: LangChainGlyphTool[] = []
  for (const entry of lexicon) {
    tools.push(await buildTool(client, entry, options))
  }
  return tools
}

/**
 * Synchronous low-fidelity helper — emits tools with empty input schemas
 * because it does not fetch cards. Prefer `glyphsAsLangChainTools`.
 */
export function fromLexicon(
  client: GlyphClient,
  lexicon: LexiconEntry[],
  options: GlyphsAsLangChainToolsOptions = {},
): LangChainGlyphTool[] {
  return lexicon.map((entry) => ({
    name: entry.name,
    description: entry.intent,
    schema: { jsonSchema: {} },
    invoke: makeInvoke(client, entry.name, options),
  }))
}

async function buildTool(
  client: GlyphClient,
  entry: LexiconEntry,
  options: GlyphsAsLangChainToolsOptions,
): Promise<LangChainGlyphTool> {
  let schema: unknown = {}
  try {
    const card: GlyphCard = await client.getCard(entry.name, 'rich')
    if (card.input) schema = card.input
  } catch (err) {
    console.warn(
      `[@glyphp/integration-langchain] could not fetch card for "${entry.name}"; LLM will receive raw JSON. ${(err as Error).message ?? err}`,
    )
  }
  return {
    name: entry.name,
    description: entry.intent,
    schema: { jsonSchema: schema },
    invoke: makeInvoke(client, entry.name, options),
  }
}

function makeInvoke(
  client: GlyphClient,
  name: string,
  options: GlyphsAsLangChainToolsOptions,
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
    // LangChain tools conventionally return strings. We JSON-stringify the
    // payload so structured output survives the round trip.
    return JSON.stringify((envelope as { payload: unknown }).payload)
  }
}
