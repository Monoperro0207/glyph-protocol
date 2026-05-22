import { z } from 'zod'
import { computeGlyphId } from '@glyphp/core'
import type { GlyphCard } from '@glyphp/types'
import type { GlyphDefinition } from '@glyphp/server'
import type {
  HttpMethod,
  JsonSchema,
  OpenApiDoc,
  Operation,
} from './openapi-types.js'

const HTTP_METHODS: HttpMethod[] = ['get', 'post', 'put', 'patch', 'delete']

export interface OpenApiAdapterOptions {
  baseUrl: string
  provider?: string
}

export function glyphsFromOpenApi(
  doc: OpenApiDoc,
  options: OpenApiAdapterOptions
): GlyphDefinition<any, any>[] {
  const provider = options.provider ?? doc.info?.title ?? 'openapi'
  const glyphs: GlyphDefinition<any, any>[] = []

  for (const [path, item] of Object.entries(doc.paths ?? {})) {
    for (const method of HTTP_METHODS) {
      const op = item[method]
      if (!op) continue

      const cardBase = {
        version: '1.0.0',
        name: operationName(method, path, op),
        intent:
          op.summary ?? op.description ?? `${method.toUpperCase()} ${path}`,
        tags: op.tags ?? [],
        cost: deriveCost(method),
        idempotent: method === 'get' || method === 'put' || method === 'delete',
        input: buildInputSchema(op, doc),
        output: buildOutputSchema(op, doc),
        examples: [],
        failureModes: [
          {
            code: 'HTTP_ERROR',
            description: 'The upstream API returned a non-2xx status',
          },
        ],
        provider,
      }
      const card: GlyphCard = {
        ...cardBase,
        id: computeGlyphId(cardBase),
        createdAt: new Date().toISOString(),
      }
      glyphs.push({
        card,
        inputSchema: buildZodInput(op, doc),
        // External API responses are not trustworthy enough to validate
        // strictly; the precise JSON Schema still lives on the card.
        outputSchema: z.unknown(),
        handler: buildHandler(method, path, op, options.baseUrl),
      })
    }
  }
  return glyphs
}

function deriveCost(method: HttpMethod): GlyphCard['cost'] {
  const isRead = method === 'get'
  return {
    latency: 'medium',
    sideEffects: !isRead,
    reversible: isRead,
    riskTier: method === 'delete' ? 'danger' : isRead ? 'safe' : 'caution',
    requiresConfirmation: method === 'delete',
  }
}

function toKebab(text: string): string {
  return text
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .toLowerCase()
    .replace(/^-+|-+$/g, '')
}

function operationName(
  method: HttpMethod,
  path: string,
  op: Operation
): string {
  if (op.operationId) return toKebab(op.operationId)
  return toKebab(`${method}-${path.replace(/[{}]/g, '')}`)
}

function buildInputSchema(op: Operation, doc: OpenApiDoc): JsonSchema {
  const properties: Record<string, unknown> = {}
  const required: string[] = []
  for (const param of op.parameters ?? []) {
    properties[param.name] = resolveRefs(param.schema ?? {}, doc)
    if (param.required) required.push(param.name)
  }
  const bodySchema = op.requestBody?.content?.['application/json']?.schema
  if (bodySchema) {
    properties.body = resolveRefs(bodySchema, doc)
    if (op.requestBody?.required) required.push('body')
  }
  return { type: 'object', properties, required }
}

function buildOutputSchema(op: Operation, doc: OpenApiDoc): JsonSchema {
  const responses = op.responses ?? {}
  const key = Object.keys(responses).find((k) => k.startsWith('2'))
  const schema = key
    ? responses[key]?.content?.['application/json']?.schema
    : undefined
  return schema ? (resolveRefs(schema, doc) as JsonSchema) : {}
}

function buildZodInput(op: Operation, doc: OpenApiDoc): z.ZodTypeAny {
  const shape: Record<string, z.ZodTypeAny> = {}
  for (const param of op.parameters ?? []) {
    const resolved = param.schema
      ? (resolveRefs(param.schema, doc) as JsonSchema)
      : undefined
    const field = jsonTypeToZod(resolved)
    shape[param.name] = param.required ? field : field.optional()
  }
  const bodySchema = op.requestBody?.content?.['application/json']?.schema
  if (op.requestBody) {
    const body = bodySchema
      ? jsonTypeToZod(resolveRefs(bodySchema, doc) as JsonSchema)
      : z.unknown()
    shape.body = op.requestBody.required ? body : body.optional()
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
      : z.union(
          literals as unknown as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]
        )
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
        items && typeof items === 'object'
          ? jsonTypeToZod(items as JsonSchema)
          : z.unknown()
      )
    }
    case 'object': {
      const props = schema.properties
      if (props && typeof props === 'object') {
        const required = new Set(
          Array.isArray(schema.required) ? (schema.required as string[]) : []
        )
        const shape: Record<string, z.ZodTypeAny> = {}
        for (const [key, prop] of Object.entries(
          props as Record<string, JsonSchema>
        )) {
          const field = jsonTypeToZod(prop)
          shape[key] = required.has(key) ? field : field.optional()
        }
        return z.object(shape).passthrough()
      }
      return z.record(z.unknown())
    }
    default:
      return z.unknown()
  }
}

function buildHandler(
  method: HttpMethod,
  path: string,
  op: Operation,
  baseUrl: string
): (input: Record<string, unknown>) => Promise<unknown> {
  const params = op.parameters ?? []
  return async (input: Record<string, unknown>): Promise<unknown> => {
    let url = baseUrl.replace(/\/$/, '') + path
    const query = new URLSearchParams()
    for (const param of params) {
      const value = input[param.name]
      if (value === undefined) continue
      if (param.in === 'path') {
        url = url.replace(`{${param.name}}`, encodeURIComponent(String(value)))
      } else if (param.in === 'query') {
        query.set(param.name, String(value))
      }
    }
    const qs = query.toString()
    if (qs) url += `?${qs}`

    const init: { method: string; headers?: Record<string, string>; body?: string } = {
      method: method.toUpperCase(),
    }
    if (op.requestBody && input.body !== undefined) {
      init.headers = { 'Content-Type': 'application/json' }
      init.body = JSON.stringify(input.body)
    }

    const res = await fetch(url, init)
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} from ${init.method} ${url}`)
    }
    const text = await res.text()
    return text ? JSON.parse(text) : null
  }
}

function resolveRefs(
  node: unknown,
  doc: OpenApiDoc,
  seen: Set<string> = new Set()
): unknown {
  if (Array.isArray(node)) return node.map((n) => resolveRefs(n, doc, seen))
  if (node !== null && typeof node === 'object') {
    const ref = (node as Record<string, unknown>).$ref
    if (typeof ref === 'string') {
      if (seen.has(ref)) return {}
      const target = pointerLookup(doc, ref)
      if (target === undefined) return {}
      return resolveRefs(target, doc, new Set([...seen, ref]))
    }
    const out: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      out[key] = resolveRefs(value, doc, seen)
    }
    return out
  }
  return node
}

function pointerLookup(doc: OpenApiDoc, ref: string): unknown {
  if (!ref.startsWith('#/')) return undefined
  let current: unknown = doc
  for (const part of ref.slice(2).split('/')) {
    const key = part.replace(/~1/g, '/').replace(/~0/g, '~')
    if (current !== null && typeof current === 'object') {
      current = (current as Record<string, unknown>)[key]
    } else {
      return undefined
    }
  }
  return current
}
