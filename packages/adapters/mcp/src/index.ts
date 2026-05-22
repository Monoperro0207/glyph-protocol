import { z } from 'zod'
import { computeGlyphId } from '@glyphp/core'
import type { GlyphCard } from '@glyphp/types'
import type { GlyphDefinition } from '@glyphp/server'
import type {
  JsonSchema,
  McpCallFn,
  McpClientLike,
  McpTool,
  McpToolAnnotations,
} from './mcp-types.js'

export type {
  McpTool,
  McpToolResult,
  McpCallFn,
  McpClientLike,
} from './mcp-types.js'

export interface McpAdapterOptions {
  provider?: string
}

/**
 * Converts a list of MCP tools into registerable glyphs. The MCP `callTool`
 * function is injected, so this package does not depend on the MCP SDK.
 */
export function glyphsFromMcpTools(
  tools: McpTool[],
  callTool: McpCallFn,
  options?: McpAdapterOptions
): GlyphDefinition<any, any>[] {
  const provider = options?.provider ?? 'mcp'

  return tools.map((tool) => {
    const cardBase = {
      version: '1.0.0',
      name: toKebab(tool.name),
      intent: tool.description ?? tool.name,
      tags: ['mcp'],
      cost: deriveCost(tool.name, tool.annotations),
      idempotent: tool.annotations?.idempotentHint ?? false,
      input: tool.inputSchema ?? { type: 'object' },
      output: tool.outputSchema ?? {},
      examples: [],
      failureModes: [
        { code: 'MCP_ERROR', description: 'The MCP tool call returned an error' },
      ],
      provider,
    }
    const card: GlyphCard = {
      ...cardBase,
      id: computeGlyphId(cardBase),
      createdAt: new Date().toISOString(),
    }
    return {
      card,
      inputSchema: buildZodInput(tool.inputSchema),
      // External MCP tool output is not trustworthy enough to validate
      // strictly; the declared outputSchema still lives on the card.
      outputSchema: z.unknown(),
      // The handler uses the original (non-kebab) MCP tool name.
      handler: buildHandler(tool.name, callTool),
    }
  })
}

/**
 * Connects the conversion to a live MCP client (anything matching the official
 * SDK's Client shape): lists its tools and wires each handler to callTool.
 */
export async function glyphsFromMcpClient(
  client: McpClientLike,
  options?: McpAdapterOptions
): Promise<GlyphDefinition<any, any>[]> {
  const { tools } = await client.listTools()
  const callTool: McpCallFn = (name, args) =>
    client.callTool({ name, arguments: args })
  return glyphsFromMcpTools(tools, callTool, options)
}

// Words that, when they appear in a tool name, mark it as risky regardless of
// what the MCP server's annotations claim.
const DANGEROUS_TOOL_WORDS =
  /\b(delete|destroy|remove|truncate|exec|overwrite|wipe|purge|drop|write|update|kill)\b/

function isDangerousName(name: string): boolean {
  const normalized = name
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
  return DANGEROUS_TOOL_WORDS.test(normalized)
}

function deriveCost(
  toolName: string,
  annotations?: McpToolAnnotations
): GlyphCard['cost'] {
  // MCP annotations are advisory, not authority. A dangerous-looking tool
  // name overrides a benign readOnlyHint — a malicious server can lie.
  const dangerousName = isDangerousName(toolName)
  const readOnly = annotations?.readOnlyHint === true && !dangerousName
  const destructive = annotations?.destructiveHint === true || dangerousName
  return {
    latency: 'medium',
    sideEffects: !readOnly,
    reversible: readOnly,
    riskTier: destructive ? 'danger' : readOnly ? 'safe' : 'caution',
    requiresConfirmation: destructive,
  }
}

function buildHandler(
  toolName: string,
  callTool: McpCallFn
): (input: Record<string, unknown>) => Promise<unknown> {
  return async (input: Record<string, unknown>): Promise<unknown> => {
    const result = await callTool(toolName, input ?? {})
    if (result.isError) {
      const text =
        result.content
          ?.map((block) => block.text)
          .filter(Boolean)
          .join(' ') || 'unknown error'
      throw new Error(`MCP tool "${toolName}" failed: ${text}`)
    }
    return result.structuredContent ?? result.content ?? null
  }
}

function buildZodInput(schema?: JsonSchema): z.ZodTypeAny {
  if (
    !schema ||
    schema.type !== 'object' ||
    typeof schema.properties !== 'object' ||
    schema.properties === null
  ) {
    return z.record(z.unknown())
  }
  const properties = schema.properties as Record<string, JsonSchema>
  const required = new Set(
    Array.isArray(schema.required) ? (schema.required as string[]) : []
  )
  const shape: Record<string, z.ZodTypeAny> = {}
  for (const [key, propSchema] of Object.entries(properties)) {
    const field = jsonTypeToZod(propSchema)
    shape[key] = required.has(key) ? field : field.optional()
  }
  return z.object(shape).passthrough()
}

function jsonTypeToZod(schema: JsonSchema | undefined): z.ZodTypeAny {
  switch (schema?.type) {
    case 'string':
      return z.string()
    case 'number':
    case 'integer':
      return z.number()
    case 'boolean':
      return z.boolean()
    case 'array':
      return z.array(z.unknown())
    case 'object':
      return z.record(z.unknown())
    default:
      return z.unknown()
  }
}

function toKebab(text: string): string {
  return text
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .toLowerCase()
    .replace(/^-+|-+$/g, '')
}
