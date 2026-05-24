import type { GlyphClient } from '@glyphp/client'
import type { LexiconEntry } from '@glyphp/types'

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
   * Hook invoked when a glyph carries `requiresConfirmation: true` — the
   * integration calls this to obtain a token (after the human approves the
   * cost summary) and then forwards it to `client.call`. Default: refuses
   * to execute confirmation-required tools.
   */
  onConfirmation?: (ticket: {
    glyphName: string
    cost: unknown
    input: unknown
  }) => Promise<string | undefined>
}

/**
 * Converts every glyph in `lexicon` (or every glyph the client discovers)
 * into a Vercel AI SDK tool. Each tool's `execute` calls the glyph through
 * `client.call`, transparently passing through input/output validation, the
 * confirmation gate, and the signed receipt.
 */
export async function glyphsAsVercelAiTools(
  client: GlyphClient,
  options: GlyphsAsVercelAiToolsOptions = {}
): Promise<Record<string, VercelAiTool>> {
  const lexicon = await client.getLexicon()
  return fromLexicon(client, lexicon, options)
}

/** Same as `glyphsAsVercelAiTools` but accepts an already-fetched lexicon. */
export function fromLexicon(
  client: GlyphClient,
  lexicon: LexiconEntry[],
  options: GlyphsAsVercelAiToolsOptions = {}
): Record<string, VercelAiTool> {
  const out: Record<string, VercelAiTool> = {}
  for (const entry of lexicon) {
    out[entry.name] = {
      description: entry.intent,
      parameters: { jsonSchema: {} }, // filled lazily — see makeExecute.
      execute: makeExecute(client, entry.name, options),
    }
  }
  return out
}

function makeExecute(
  client: GlyphClient,
  name: string,
  options: GlyphsAsVercelAiToolsOptions
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
