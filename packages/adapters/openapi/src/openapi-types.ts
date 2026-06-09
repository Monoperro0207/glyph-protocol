// A minimal subset of the OpenAPI 3.x document shape — only what the adapter
// reads. Not a full OpenAPI type definition.

export type JsonSchema = Record<string, unknown>

export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete'

export interface OpenApiDoc {
  openapi: string
  info: { title: string; version: string; description?: string }
  servers?: Array<{ url: string }>
  paths: Record<string, PathItem>
  components?: {
    schemas?: Record<string, JsonSchema>
    securitySchemes?: Record<string, SecurityScheme>
  }
  security?: Array<Record<string, string[]>>
}

export type PathItem = Partial<Record<HttpMethod, Operation>>

export interface Operation {
  operationId?: string
  summary?: string
  description?: string
  tags?: string[]
  parameters?: Parameter[]
  requestBody?: RequestBody
  responses?: Record<string, ResponseObject>
  security?: Array<Record<string, string[]>>
  /**
   * Vendor extension: the API author's explicit Glyph risk tier for this
   * operation, overriding the HTTP-method heuristic. Trusted at the same level
   * as the rest of the spec (the API owner writes it). Must be one of
   * `safe` | `caution` | `danger`; an unrecognised value is rejected.
   */
  'x-glyph-risk'?: string
}

export interface SecurityScheme {
  type: 'apiKey' | 'http' | 'oauth2' | 'openIdConnect'
  scheme?: string
  in?: 'header' | 'query' | 'cookie'
  name?: string
  bearerFormat?: string
}

export interface Parameter {
  name: string
  in: 'path' | 'query' | 'header' | 'cookie'
  required?: boolean
  description?: string
  schema?: JsonSchema
}

export interface RequestBody {
  required?: boolean
  content?: Record<string, { schema?: JsonSchema }>
}

export interface ResponseObject {
  description?: string
  content?: Record<string, { schema?: JsonSchema }>
}
