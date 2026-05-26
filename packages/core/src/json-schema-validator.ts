// Ajv 8 ships as CommonJS with a default export that TS sees as a namespace
// under ESM; unwrap once to get the actual constructor.
import Ajv2020Import from 'ajv/dist/2020.js'
import addFormatsImport from 'ajv-formats'
import { z } from 'zod'

const Ajv2020 = ((Ajv2020Import as any).default ?? Ajv2020Import) as new (
  opts?: object,
) => {
  compile: (schema: object) => ((value: unknown) => boolean) & {
    errors?: Array<{ instancePath?: string; message?: string }> | null
  }
}
const addFormats = ((addFormatsImport as any).default ?? addFormatsImport) as (
  ajv: unknown,
  formats?: string[] | object,
) => unknown

/** Thrown when a JSON Schema exceeds the complexity limits. */
export class SchemaComplexityError extends Error {
  constructor(
    message: string,
    public readonly detail: { nodes: number; depth: number; maxNodes: number; maxDepth: number },
  ) {
    super(message)
    this.name = 'SchemaComplexityError'
  }
}

/** Thrown when a JSON Schema cannot be compiled by AJV. */
export class SchemaCompilationError extends Error {
  constructor(
    message: string,
    public readonly cause?: Error,
  ) {
    super(message)
    this.name = 'SchemaCompilationError'
  }
}

/**
 * Recursively walks a JSON Schema value and counts:
 *   - `nodes`: every object encountered (including the root)
 *   - `depth`: maximum nesting depth (root is depth 1)
 *
 * Throws `SchemaComplexityError` if either limit is exceeded.
 */
export function validateSchemaComplexity(schema: unknown, maxNodes = 1000, maxDepth = 32): void {
  let totalNodes = 0
  let maxSeenDepth = 0

  function walk(node: unknown, depth: number): void {
    if (depth > maxSeenDepth) maxSeenDepth = depth
    if (node === null || typeof node !== 'object') return
    totalNodes++
    if (totalNodes > maxNodes) {
      throw new SchemaComplexityError(
        `SCHEMA_TOO_COMPLEX: schema has at least ${totalNodes} nodes (max ${maxNodes})`,
        { nodes: totalNodes, depth: maxSeenDepth, maxNodes, maxDepth },
      )
    }
    if (depth > maxDepth) {
      throw new SchemaComplexityError(
        `SCHEMA_TOO_COMPLEX: schema depth ${depth} exceeds maximum ${maxDepth}`,
        { nodes: totalNodes, depth, maxNodes, maxDepth },
      )
    }
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1)
    } else {
      for (const value of Object.values(node as Record<string, unknown>)) {
        walk(value, depth + 1)
      }
    }
  }

  walk(schema, 1)
}

/**
 * Options for `compileJsonSchema`.
 */
export interface CompileJsonSchemaOptions {
  /**
   * When `'none'`, output validation is disabled — the returned validator
   * passes through any value (`z.unknown()`). Use this escape hatch only when
   * you explicitly intend to skip output validation.
   */
  outputValidation?: 'none'
}

/**
 * Compiles a JSON Schema (draft 2020-12) into a Zod-compatible validator.
 *
 * The protocol promises that a server validates handler output against the
 * card's declared `output` schema before sealing the envelope. Native glyphs
 * defined with `defineGlyph` get this for free because they ship a Zod
 * schema, but adapters (MCP, OpenAPI) start from a raw JSON Schema. This
 * function bridges the gap — the returned validator plugs into the same
 * `safeParse` contract the server already expects.
 *
 * The result accepts any JSON value and emits per-error Zod issues with paths
 * derived from `instancePath`, so downstream code (and the
 * `OUTPUT_VALIDATION_FAILED` error response) gets useful diagnostics.
 *
 * @throws {SchemaCompilationError} When the schema cannot be compiled by AJV
 *   and `outputValidation` is not set to `'none'`.
 */
export function compileJsonSchema(
  schema: unknown,
  opts?: CompileJsonSchemaOptions,
): z.ZodTypeAny {
  if (opts?.outputValidation === 'none') {
    // Explicit opt-out: skip validation entirely, return passthrough.
    return z.unknown()
  }

  if (
    schema === undefined ||
    schema === null ||
    (typeof schema === 'object' &&
      schema !== null &&
      Object.keys(schema as Record<string, unknown>).length === 0)
  ) {
    // An empty or absent schema means "no constraint declared". Pass through.
    return z.unknown()
  }

  const ajv = new Ajv2020({
    strict: false,
    allErrors: true,
    coerceTypes: false,
  })
  addFormats(ajv)

  validateSchemaComplexity(schema)

  let validate: ReturnType<(typeof ajv)['compile']>
  try {
    validate = ajv.compile(schema as object)
  } catch (cause) {
    throw new SchemaCompilationError(
      `SCHEMA_COMPILATION_FAILED: the JSON Schema could not be compiled by AJV — ${(cause as Error).message}`,
      cause instanceof Error ? cause : undefined,
    )
  }

  return z.unknown().superRefine((value, ctx) => {
    if (validate(value)) return
    for (const err of validate.errors ?? []) {
      const path = (err.instancePath || '')
        .split('/')
        .filter(Boolean)
        .map((segment: string) => {
          const n = Number(segment)
          return Number.isInteger(n) && String(n) === segment ? n : segment
        })
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${err.instancePath || '<root>'} ${err.message ?? 'failed validation'}`,
        path,
      })
    }
  })
}
