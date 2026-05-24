// Ajv 8 ships as CommonJS with a default export that TS sees as a namespace
// under ESM; unwrap once to get the actual constructor.
import Ajv2020Import from 'ajv/dist/2020.js'
import addFormatsImport from 'ajv-formats'
import { z } from 'zod'

const Ajv2020 = (
  (Ajv2020Import as any).default ?? Ajv2020Import
) as new (opts?: object) => {
  compile: (schema: object) => ((value: unknown) => boolean) & {
    errors?: Array<{ instancePath?: string; message?: string }> | null
  }
}
const addFormats = (
  (addFormatsImport as any).default ?? addFormatsImport
) as (ajv: unknown, formats?: string[] | object) => unknown

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
 */
export function compileJsonSchema(schema: unknown): z.ZodTypeAny {
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

  let validate: ReturnType<(typeof ajv)['compile']>
  try {
    validate = ajv.compile(schema as object)
  } catch {
    // A malformed schema should not crash the server; degrade to passthrough.
    return z.unknown()
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
