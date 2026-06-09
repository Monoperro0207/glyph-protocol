import { compileJsonSchema, computeGlyphId } from '@glyphp/core'
import type { GlyphDefinition } from '@glyphp/server'
import type { GlyphCard } from '@glyphp/types'
import { z } from 'zod'
import type {
  JsonSchema,
  McpCallFn,
  McpClientLike,
  McpTool,
  McpToolAnnotations,
} from './mcp-types.js'

export type {
  McpCallFn,
  McpClientLike,
  McpTool,
  McpToolResult,
} from './mcp-types.js'

export interface McpAdapterOptions {
  provider?: string
  /**
   * Controls validation of MCP tool output against the declared `outputSchema`.
   * - `'schema'` (default): compile the JSON Schema and reject mismatched
   *   output with `OUTPUT_VALIDATION_FAILED` — the card and the runtime agree.
   * - `'none'`: accept any output. Use only when the upstream MCP server is
   *   trusted to honor its own schema; the card still publishes the schema.
   */
  outputValidation?: 'schema' | 'none'
  /**
   * Maximum number of tools to import. A hostile or misconfigured MCP server
   * can advertise thousands of tools, inflating the agent's tool surface and
   * attack blast radius. When the server exposes more than this, the import
   * throws rather than silently truncating (dropping a tool you expected is
   * itself a hazard). Default: no limit (the current behavior).
   */
  maxTools?: number
  /**
   * When `true`, MCP tool descriptions are NOT copied into `card.intent`; a
   * neutral placeholder (the tool name) is used instead. A description is
   * attacker-controlled text — redacting it prevents an untrusted server from
   * smuggling instructions or secrets into the card a human reviews. The MCP
   * tool name is still used (it drives risk derivation). Default: `false`.
   */
  redactDescriptions?: boolean
  /**
   * When `true`, an MCP tool error surfaces a generic message instead of the
   * upstream error text, which may carry secrets or injected content. Default:
   * `false` (the upstream text is included, aiding debugging of trusted servers).
   */
  sanitizeErrors?: boolean
  /**
   * Timeout (ms) for the `listTools()` call in {@link glyphsFromMcpClient}.
   * Throws on timeout so a hung or slow server cannot stall import
   * indefinitely. Default: no timeout (the current behavior).
   */
  listToolsTimeoutMs?: number
}

/**
 * Converts a list of MCP tools into registerable glyphs. The MCP `callTool`
 * function is injected, so this package does not depend on the MCP SDK.
 */
export function glyphsFromMcpTools(
  tools: McpTool[],
  callTool: McpCallFn,
  options?: McpAdapterOptions,
): GlyphDefinition<any, any>[] {
  const provider = options?.provider ?? 'mcp'
  const outputValidation = options?.outputValidation ?? 'schema'
  const redactDescriptions = options?.redactDescriptions ?? false
  const sanitizeErrors = options?.sanitizeErrors ?? false

  if (options?.maxTools != null && tools.length > options.maxTools) {
    throw new Error(
      `MCP server exposed ${tools.length} tools, exceeding maxTools=${options.maxTools}`,
    )
  }

  return tools.map((tool) => {
    const cardBase = {
      version: '1.0.0',
      name: toKebab(tool.name),
      intent: redactDescriptions ? tool.name : (tool.description ?? tool.name),
      tags: ['mcp'],
      cost: deriveCost(tool.name, tool.annotations),
      idempotent: tool.annotations?.idempotentHint ?? false,
      input: tool.inputSchema ?? { type: 'object' },
      output: tool.outputSchema ?? {},
      examples: [],
      failureModes: [{ code: 'MCP_ERROR', description: 'The MCP tool call returned an error' }],
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
      // Honor the declared outputSchema by default. The server validates
      // upstream output against it; a mismatch becomes OUTPUT_VALIDATION_FAILED
      // rather than silently passing through a contract violation.
      outputSchema:
        outputValidation === 'schema' && tool.outputSchema
          ? compileJsonSchema(tool.outputSchema)
          : z.unknown(),
      // The handler uses the original (non-kebab) MCP tool name.
      handler: buildHandler(tool.name, callTool, sanitizeErrors),
    }
  })
}

/**
 * Connects the conversion to a live MCP client (anything matching the official
 * SDK's Client shape): lists its tools and wires each handler to callTool.
 */
export async function glyphsFromMcpClient(
  client: McpClientLike,
  options?: McpAdapterOptions,
): Promise<GlyphDefinition<any, any>[]> {
  const { tools } = await withTimeout(client.listTools(), options?.listToolsTimeoutMs, 'listTools')
  const callTool: McpCallFn = (name, args) => client.callTool({ name, arguments: args })
  return glyphsFromMcpTools(tools, callTool, options)
}

/** Rejects with a clear error if `promise` does not settle within `timeoutMs`. */
function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number | undefined,
  label: string,
): Promise<T> {
  if (timeoutMs == null) return promise
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`MCP ${label} timed out after ${timeoutMs}ms`)),
      timeoutMs,
    )
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      },
    )
  })
}

// Re-export for tests and downstream consumers that want to validate raw
// JSON Schema output without taking a direct dep on @glyphp/core.
export { compileJsonSchema } from '@glyphp/core'

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

function deriveCost(toolName: string, annotations?: McpToolAnnotations): GlyphCard['cost'] {
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
  callTool: McpCallFn,
  sanitizeErrors: boolean,
): (input: Record<string, unknown>) => Promise<unknown> {
  return async (input: Record<string, unknown>): Promise<unknown> => {
    const result = await callTool(toolName, input ?? {})
    if (result.isError) {
      if (sanitizeErrors) {
        // Do not echo upstream error text — it may carry secrets or injected
        // content. The failure mode and tool name are enough to act on.
        throw new Error(`MCP tool "${toolName}" failed`)
      }
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
    return z.record(z.string(), z.unknown())
  }
  const properties = schema.properties as Record<string, JsonSchema>
  const required = new Set(Array.isArray(schema.required) ? (schema.required as string[]) : [])
  const shape: Record<string, z.ZodTypeAny> = {}
  for (const [key, propSchema] of Object.entries(properties)) {
    const field = jsonTypeToZod(propSchema)
    shape[key] = required.has(key) ? field : field.optional()
  }
  return z.object(shape).passthrough()
}

/**
 * Converts a JSON Schema node into a Zod validator. Recursive: enums, typed
 * arrays, nested objects and common string formats all survive the conversion,
 * so an adapted glyph validates more than a value's top-level type.
 */
function jsonTypeToZod(schema: JsonSchema | undefined): z.ZodTypeAny {
  if (!schema || typeof schema !== 'object') return z.unknown()

  const enumValues = schema.enum
  if (Array.isArray(enumValues) && enumValues.length > 0) {
    const literals = enumValues.map((v) => z.literal(v as never))
    return literals.length === 1
      ? literals[0]
      : z.union(literals as unknown as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]])
  }

  switch (schema.type) {
    case 'string': {
      let s = z.string()
      if (schema.format === 'email') s = s.email()
      else if (schema.format === 'uri' || schema.format === 'url') s = s.url()
      else if (schema.format === 'uuid') s = s.uuid()
      else if (schema.format === 'date-time') s = s.datetime()
      return s
    }
    case 'integer':
      return z.number().int()
    case 'number':
      return z.number()
    case 'boolean':
      return z.boolean()
    case 'array': {
      const items = schema.items
      return z.array(
        items && typeof items === 'object' ? jsonTypeToZod(items as JsonSchema) : z.unknown(),
      )
    }
    case 'object': {
      const props = schema.properties
      if (props && typeof props === 'object') {
        const required = new Set(
          Array.isArray(schema.required) ? (schema.required as string[]) : [],
        )
        const shape: Record<string, z.ZodTypeAny> = {}
        for (const [key, prop] of Object.entries(props as Record<string, JsonSchema>)) {
          const field = jsonTypeToZod(prop)
          shape[key] = required.has(key) ? field : field.optional()
        }
        return z.object(shape).passthrough()
      }
      return z.record(z.string(), z.unknown())
    }
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
