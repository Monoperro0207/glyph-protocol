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
