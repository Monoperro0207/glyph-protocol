import { z } from 'zod'
import { compileJsonSchema, computeGlyphId } from '@glyphp/core'
import type { GlyphCard } from '@glyphp/types'
import type { GlyphDefinition } from '@glyphp/server'
import type {
  HttpMethod,
  JsonSchema,
  OpenApiDoc,
  Operation,
  Parameter,
  SecurityScheme,
} from './openapi-types.js'

const HTTP_METHODS: HttpMethod[] = ['get', 'post', 'put', 'patch', 'delete']

/**
 * Auth credentials supplied by the adapter operator. The OpenAPI document
 * names the schemes (under `components.securitySchemes`); the operator
 * provides the actual values here. The adapter looks up each scheme by name
 * and applies it as a header / query param / cookie / Authorization header.
 */
export interface OpenApiSecurityConfig {
  /** scheme-name → credential. Resolved against `components.securitySchemes`. */
  schemes?: Record<
    string,
    | { type: 'bearer'; token: string }
    | { type: 'basic'; username: string; password: string }
    | { type: 'apiKey'; value: string }
  >
}

export interface OpenApiAdapterOptions {
  /**
   * Base URL for the upstream API. Optional — if the document declares
   * `servers[]`, the first entry is used as a fallback. An error is thrown
   * at adapt-time when neither is available.
   */
  baseUrl?: string
  provider?: string
  /**
   * - `'schema'` (default): validate every upstream response against the
   *   declared 2xx response schema and fail with OUTPUT_VALIDATION_FAILED on
   *   a mismatch.
   * - `'none'`: passthrough; the card still publishes the schema.
   */
  outputValidation?: 'schema' | 'none'
  /** Credentials for the OpenAPI security schemes the operation declares. */
  security?: OpenApiSecurityConfig
}

export function glyphsFromOpenApi(
  doc: OpenApiDoc,
  options: OpenApiAdapterOptions
): GlyphDefinition<any, any>[] {
  const provider = options.provider ?? doc.info?.title ?? 'openapi'
  const baseUrl = options.baseUrl ?? doc.servers?.[0]?.url
  if (!baseUrl) {
    throw new Error(
      'OpenAPI adapter requires a baseUrl (or a `servers[]` entry in the document)'
    )
  }
  const outputValidation = options.outputValidation ?? 'schema'
  const securitySchemes = doc.components?.securitySchemes ?? {}
  const documentSecurity = doc.security ?? []
  const glyphs: GlyphDefinition<any, any>[] = []

  for (const [path, item] of Object.entries(doc.paths ?? {})) {
    for (const method of HTTP_METHODS) {
      const op = item[method]
      if (!op) continue

      const outputSchemaJson = buildOutputSchema(op, doc)
      const cardBase = {
        version: '1.0.0',
        name: operationName(method, path, op),
        intent:
          op.summary ?? op.description ?? `${method.toUpperCase()} ${path}`,
        tags: op.tags ?? [],
        cost: deriveCost(method),
        idempotent: method === 'get' || method === 'put' || method === 'delete',
        input: buildInputSchema(op, doc),
        output: outputSchemaJson,
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
        outputSchema:
          outputValidation === 'schema' && outputSchemaJson &&
          Object.keys(outputSchemaJson).length > 0
            ? compileJsonSchema(outputSchemaJson)
            : z.unknown(),
        handler: buildHandler(method, path, op, baseUrl, {
          securitySchemes,
          documentSecurity,
          credentials: options.security?.schemes ?? {},
        }),
      })
    }
  }
  return glyphs
}

export { compileJsonSchema } from '@glyphp/core'

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

interface SecurityContext {
  securitySchemes: Record<string, SecurityScheme>
  documentSecurity: Array<Record<string, string[]>>
  credentials: NonNullable<OpenApiSecurityConfig['schemes']>
}

function buildHandler(
  method: HttpMethod,
  path: string,
  op: Operation,
  baseUrl: string,
  security: SecurityContext
): (input: Record<string, unknown>) => Promise<unknown> {
  const params = op.parameters ?? []
  const effectiveSecurity = op.security ?? security.documentSecurity

  return async (input: Record<string, unknown>): Promise<unknown> => {
    let url = baseUrl.replace(/\/$/, '') + path
    const query = new URLSearchParams()
    const headers: Record<string, string> = {}
    const cookies: string[] = []

    for (const param of params) {
      const value = input[param.name]
      if (value === undefined) continue
      switch (param.in) {
        case 'path':
          url = url.replace(`{${param.name}}`, encodeURIComponent(String(value)))
          break
        case 'query':
          appendQuery(query, param, value)
          break
        case 'header':
          headers[param.name] = String(value)
          break
        case 'cookie':
          cookies.push(`${param.name}=${encodeURIComponent(String(value))}`)
          break
      }
    }

    applySecurity(effectiveSecurity, security, headers, query, cookies)

    const qs = query.toString()
    if (qs) url += `?${qs}`
    if (cookies.length > 0) headers['Cookie'] = cookies.join('; ')

    const init: { method: string; headers: Record<string, string>; body?: string } = {
      method: method.toUpperCase(),
      headers,
    }
    if (op.requestBody && input.body !== undefined) {
      init.headers['Content-Type'] = 'application/json'
      init.body = JSON.stringify(input.body)
    }

    const res = await fetch(url, init)
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} from ${init.method} ${url}`)
    }
    return parseResponse(res)
  }
}

function appendQuery(
  query: URLSearchParams,
  param: Parameter,
  value: unknown
): void {
  // OpenAPI's default style for query is `form` with `explode=true`: arrays
  // become repeated keys, objects flatten into keys. We honor that without
  // depending on full spec semantics — enough for the common case.
  if (Array.isArray(value)) {
    for (const item of value) query.append(param.name, String(item))
    return
  }
  if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      query.append(k, String(v))
    }
    return
  }
  query.append(param.name, String(value))
}

function applySecurity(
  requirements: Array<Record<string, string[]>>,
  ctx: SecurityContext,
  headers: Record<string, string>,
  query: URLSearchParams,
  cookies: string[]
): void {
  for (const requirement of requirements) {
    for (const schemeName of Object.keys(requirement)) {
      const scheme = ctx.securitySchemes[schemeName]
      const credential = ctx.credentials[schemeName]
      if (!scheme || !credential) continue
      if (scheme.type === 'http' && scheme.scheme === 'bearer') {
        if (credential.type === 'bearer') {
          headers['Authorization'] = `Bearer ${credential.token}`
        }
        continue
      }
      if (scheme.type === 'http' && scheme.scheme === 'basic') {
        if (credential.type === 'basic') {
          const enc = Buffer.from(
            `${credential.username}:${credential.password}`
          ).toString('base64')
          headers['Authorization'] = `Basic ${enc}`
        }
        continue
      }
      if (scheme.type === 'apiKey' && scheme.name) {
        const value =
          credential.type === 'apiKey' ? credential.value : undefined
        if (!value) continue
        if (scheme.in === 'header') headers[scheme.name] = value
        else if (scheme.in === 'query') query.set(scheme.name, value)
        else if (scheme.in === 'cookie') {
          cookies.push(`${scheme.name}=${encodeURIComponent(value)}`)
        }
      }
      // oauth2 / openIdConnect: out of scope for v1; the operator can pass a
      // bearer token via an `http`/`bearer` scheme alias if they need to.
    }
  }
}

async function parseResponse(res: Response): Promise<unknown> {
  const contentType = res.headers?.get?.('content-type') ?? ''
  const text = await res.text()
  if (!text) return null
  // Treat empty or JSON content-types as JSON to stay compatible with mocked
  // fetch responses that omit headers — the common case in tests.
  if (!contentType || contentType.includes('application/json')) {
    try {
      return JSON.parse(text)
    } catch {
      return contentType ? { raw: text, contentType } : null
    }
  }
  return { raw: text, contentType }
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
