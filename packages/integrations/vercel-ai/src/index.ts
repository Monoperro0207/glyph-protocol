import type { GlyphClient } from '@glyphp/client'
import type { GlyphCard, LexiconEntry } from '@glyphp/types'

/**
 * Shape compatible with Vercel AI SDK's `tool({...})` factory — duck-typed
 * so this package does not take a hard dependency on `ai`. Pass the returned
 * record to `streamText({ tools })` or `generateText({ tools })`.
 */
export interface VercelAiTool {
  description: string
  parameters: { jsonSchema: unknown }
  execute: (input: Record<string, unknown>) => Promise<unknown>
}

export interface GlyphsAsVercelAiToolsOptions {
  /**
   * Approval hook invoked when a glyph carries `requiresConfirmation: true`.
   * The hook receives the prepared ticket — including the bound
   * `confirmationToken` — and MUST return `true` to authorize execution.
   * Any other value (including `false`, `undefined`, or a thrown error)
   * re-raises the original `CONFIRMATION_REQUIRED` error and the call is
   * not executed. Returning a non-boolean is treated as `false`.
   *
   * Default: never approves — the original `CONFIRMATION_REQUIRED` error is
   * propagated to the agent so it can ask the user out-of-band.
   */
  onConfirmation?: (ticket: {
    glyphName: string
    cost: unknown
    input: unknown
    confirmationToken: string
  }) => Promise<boolean>
}

/**
 * Converts every glyph the client discovers into a Vercel AI SDK tool, with
 * each tool's `parameters.jsonSchema` populated from the glyph card's real
 * `input` schema so the LLM can structure arguments correctly. Each tool's
 * `execute` calls the glyph through `client.call`, transparently passing
 * through input/output validation, the confirmation gate, and the signed
 * receipt.
 */
export async function glyphsAsVercelAiTools(
  client: GlyphClient,
  options: GlyphsAsVercelAiToolsOptions = {},
): Promise<Record<string, VercelAiTool>> {
  const lexicon = await client.getLexicon()
  const out: Record<string, VercelAiTool> = {}
  for (const entry of lexicon) {
    out[entry.name] = await buildTool(client, entry, options)
  }
  return out
}

/**
 * Synchronous low-fidelity helper — emits tools with empty input schemas
 * because it does not fetch cards. Prefer `glyphsAsVercelAiTools`, which
 * exposes real schemas. Useful only when a caller already has a lexicon
 * and explicitly wants to skip the per-glyph `getCard` round trip.
 */
export function fromLexicon(
  client: GlyphClient,
  lexicon: LexiconEntry[],
  options: GlyphsAsVercelAiToolsOptions = {},
): Record<string, VercelAiTool> {
  const out: Record<string, VercelAiTool> = {}
  for (const entry of lexicon) {
    out[entry.name] = {
      description: entry.intent,
      parameters: { jsonSchema: {} },
      execute: makeExecute(client, entry.name, options),
    }
  }
  return out
}

async function buildTool(
  client: GlyphClient,
  entry: LexiconEntry,
  options: GlyphsAsVercelAiToolsOptions,
): Promise<VercelAiTool> {
  let schema: unknown = {}
  try {
    const card: GlyphCard = await client.getCard(entry.name, 'rich')
    if (card.input) schema = card.input
  } catch (err) {
    console.warn(
      `[@glyphp/integration-vercel-ai] could not fetch card for "${entry.name}"; LLM will receive raw JSON. ${(err as Error).message ?? err}`,
    )
  }
  return {
    description: entry.intent,
    parameters: { jsonSchema: schema },
    execute: makeExecute(client, entry.name, options),
  }
}

function makeExecute(
  client: GlyphClient,
  name: string,
  options: GlyphsAsVercelAiToolsOptions,
): VercelAiTool['execute'] {
  return async (input) => {
    const envelope = await client.call(name, input).catch(async (err) => {
      // Translate the protocol's confirmation-required failure into a
      // friendlier path via the operator-provided hook.
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
        // Strict boolean check: anything other than `true` rejects. A
        // human-written hook that returns "reject" or a Promise that
        // resolves to undefined never authorizes execution.
        if (approved !== true) throw err
        return client.call(name, input, { confirmationToken: ticket.confirmationToken })
      }
      throw err
    })
    return (envelope as { payload: unknown }).payload
  }
}
