import type { GlyphClient } from '@glyphp/client'
import type { GlyphCard, LexiconEntry } from '@glyphp/types'

/**
 * Duck-typed shape that LlamaIndex.TS's `FunctionTool.from({...})` accepts —
 * the integration emits these plain objects so this package does not depend
 * on `llamaindex` at runtime.
 */
export interface LlamaIndexGlyphTool {
  name: string
  description: string
  parameters: { type: 'object'; properties: Record<string, unknown>; required?: string[] }
  fn: (input: Record<string, unknown>) => Promise<unknown>
}

export interface GlyphsAsLlamaIndexToolsOptions {
  onConfirmation?: (ticket: {
    glyphName: string
    cost: unknown
    input: unknown
    confirmationToken: string
  }) => Promise<boolean>
}

export async function glyphsAsLlamaIndexTools(
  client: GlyphClient,
  options: GlyphsAsLlamaIndexToolsOptions = {},
): Promise<LlamaIndexGlyphTool[]> {
  const lexicon = await client.getLexicon()
  const tools: LlamaIndexGlyphTool[] = []
  for (const entry of lexicon) {
    tools.push(await buildTool(client, entry, options))
  }
  return tools
}

/**
 * Synchronous low-fidelity helper — emits tools with empty parameter
 * schemas. Prefer `glyphsAsLlamaIndexTools`.
 */
export function fromLexicon(
  client: GlyphClient,
  lexicon: LexiconEntry[],
  options: GlyphsAsLlamaIndexToolsOptions = {},
): LlamaIndexGlyphTool[] {
  return lexicon.map((entry) => ({
    name: entry.name,
    description: entry.intent,
    parameters: { type: 'object', properties: {} },
    fn: makeFn(client, entry.name, options),
  }))
}

async function buildTool(
  client: GlyphClient,
  entry: LexiconEntry,
  options: GlyphsAsLlamaIndexToolsOptions,
): Promise<LlamaIndexGlyphTool> {
  let parameters: LlamaIndexGlyphTool['parameters'] = { type: 'object', properties: {} }
  try {
    const card: GlyphCard = await client.getCard(entry.name, 'rich')
    parameters = mapToObjectSchema(card.input)
  } catch (err) {
    console.warn(
      `[@glyphp/integration-llamaindex] could not fetch card for "${entry.name}"; LLM will receive raw JSON. ${(err as Error).message ?? err}`,
    )
  }
  return {
    name: entry.name,
    description: entry.intent,
    parameters,
    fn: makeFn(client, entry.name, options),
  }
}

/**
 * Coerce an arbitrary JSON Schema to LlamaIndex's `{type:'object', properties}`
 * shape. If the schema is already an object schema, pass `properties` and
 * `required` through. Otherwise wrap the whole schema in a `value` property
 * so the call still works.
 */
function mapToObjectSchema(input: unknown): LlamaIndexGlyphTool['parameters'] {
  if (
    input &&
    typeof input === 'object' &&
    (input as { type?: unknown }).type === 'object' &&
    (input as { properties?: unknown }).properties &&
    typeof (input as { properties: unknown }).properties === 'object'
  ) {
    const s = input as { properties: Record<string, unknown>; required?: string[] }
    return {
      type: 'object',
      properties: s.properties,
      ...(Array.isArray(s.required) ? { required: s.required } : {}),
    }
  }
  if (!input) return { type: 'object', properties: {} }
  return {
    type: 'object',
    properties: { value: input as Record<string, unknown> },
    required: ['value'],
  }
}

function makeFn(
  client: GlyphClient,
  name: string,
  options: GlyphsAsLlamaIndexToolsOptions,
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
