import assert from 'node:assert/strict'
import { test } from 'node:test'
import { glyphsFromOpenApi } from '../src/index.js'
import type { OpenApiDoc } from '../src/openapi-types.js'

const sampleDoc: OpenApiDoc = {
  openapi: '3.0.0',
  info: { title: 'Pet API', version: '1.0.0' },
  paths: {
    '/pets': {
      get: {
        operationId: 'listPets',
        summary: 'List all pets',
        tags: ['pets'],
        parameters: [{ name: 'limit', in: 'query', schema: { type: 'integer' } }],
        responses: {
          '200': {
            description: 'ok',
            content: {
              'application/json': {
                schema: { type: 'array', items: { $ref: '#/components/schemas/Pet' } },
              },
            },
          },
        },
      },
      post: {
        operationId: 'createPet',
        summary: 'Create a pet',
        tags: ['pets'],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Pet' } } },
        },
        responses: { '201': { description: 'created' } },
      },
    },
    '/pets/{petId}': {
      get: {
        operationId: 'getPetById',
        summary: 'Get a pet by id',
        parameters: [{ name: 'petId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'ok',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Pet' } } },
          },
        },
      },
      delete: {
        operationId: 'deletePet',
        summary: 'Delete a pet',
        parameters: [{ name: 'petId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '204': { description: 'deleted' } },
      },
    },
  },
  components: {
    schemas: {
      Pet: {
        type: 'object',
        properties: { id: { type: 'string' }, name: { type: 'string' } },
        required: ['id', 'name'],
      },
    },
  },
}

function glyphs() {
  return glyphsFromOpenApi(sampleDoc, { baseUrl: 'https://api.example.com' })
}

function byName(name: string) {
  const g = glyphs().find((glyph) => glyph.card.name === name)
  assert.ok(g, `glyph ${name} not found`)
  return g
}

test('generates one glyph per operation with kebab-case names', () => {
  const names = glyphs()
    .map((g) => g.card.name)
    .sort()
  assert.deepEqual(names, ['create-pet', 'delete-pet', 'get-pet-by-id', 'list-pets'])
})

test('derives cost and risk from the HTTP method', () => {
  assert.equal(byName('list-pets').card.cost.riskTier, 'safe')
  assert.equal(byName('create-pet').card.cost.riskTier, 'caution')
  assert.equal(byName('delete-pet').card.cost.riskTier, 'danger')
  assert.equal(byName('delete-pet').card.cost.requiresConfirmation, true)
})

test('derives idempotency from the HTTP method', () => {
  assert.equal(byName('list-pets').card.idempotent, true)
  assert.equal(byName('create-pet').card.idempotent, false)
  assert.equal(byName('delete-pet').card.idempotent, true)
})

test('resolves local $ref in the generated card schemas', () => {
  const output = byName('get-pet-by-id').card.output as Record<string, unknown>
  assert.equal(output.type, 'object')
  assert.deepEqual(output.required, ['id', 'name'])
  // No unresolved $ref should remain anywhere in the schema.
  assert.ok(!JSON.stringify(output).includes('$ref'))
})

test('every generated card is content-addressed', () => {
  for (const g of glyphs()) {
    assert.match(g.card.id, /^[0-9a-f]{64}$/)
  }
})

test('handler issues a GET with a substituted path parameter', async () => {
  let captured: { url: string; method?: string } | undefined
  const realFetch = globalThis.fetch
  globalThis.fetch = (async (url: unknown, init: unknown) => {
    captured = { url: String(url), method: (init as { method?: string })?.method }
    return { ok: true, status: 200, text: async () => JSON.stringify({ id: '7', name: 'Rex' }) }
  }) as unknown as typeof fetch
  try {
    const result = await byName('get-pet-by-id').handler({ petId: '7' })
    assert.deepEqual(result, { id: '7', name: 'Rex' })
    assert.equal(captured?.url, 'https://api.example.com/pets/7')
    assert.equal(captured?.method, 'GET')
  } finally {
    globalThis.fetch = realFetch
  }
})

test('handler issues a POST with a JSON body and a query string', async () => {
  let captured: { url: string; method?: string; body?: string } | undefined
  const realFetch = globalThis.fetch
  globalThis.fetch = (async (url: unknown, init: unknown) => {
    const i = init as { method?: string; body?: string }
    captured = { url: String(url), method: i?.method, body: i?.body }
    return { ok: true, status: 201, text: async () => '' }
  }) as unknown as typeof fetch
  try {
    await byName('create-pet').handler({ body: { id: '1', name: 'Rex' } })
    assert.equal(captured?.method, 'POST')
    assert.equal(captured?.body, JSON.stringify({ id: '1', name: 'Rex' }))
    await byName('list-pets').handler({ limit: 5 })
    assert.equal(captured?.url, 'https://api.example.com/pets?limit=5')
  } finally {
    globalThis.fetch = realFetch
  }
})

test('handler throws on a non-2xx response', async () => {
  const realFetch = globalThis.fetch
  globalThis.fetch = (async () => ({
    ok: false,
    status: 404,
    text: async () => '',
  })) as unknown as typeof fetch
  try {
    await assert.rejects(byName('get-pet-by-id').handler({ petId: 'x' }), /HTTP 404/)
  } finally {
    globalThis.fetch = realFetch
  }
})

test('input schema enforces enums, typed arrays and nested objects', () => {
  const doc: OpenApiDoc = {
    openapi: '3.0.0',
    info: { title: 'Rich API', version: '1.0.0' },
    paths: {
      '/search': {
        post: {
          operationId: 'search',
          summary: 'Search',
          parameters: [
            {
              name: 'sort',
              in: 'query',
              required: true,
              schema: { type: 'string', enum: ['asc', 'desc'] },
            },
            {
              name: 'ids',
              in: 'query',
              required: true,
              schema: { type: 'array', items: { type: 'integer' } },
            },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    filter: {
                      type: 'object',
                      properties: { tag: { type: 'string' } },
                      required: ['tag'],
                    },
                  },
                  required: ['filter'],
                },
              },
            },
          },
          responses: { '200': { description: 'ok' } },
        },
      },
    },
  }
  const [glyph] = glyphsFromOpenApi(doc, { baseUrl: 'https://x.test' })
  const schema = glyph.inputSchema
  const ok = { sort: 'asc', ids: [1, 2], body: { filter: { tag: 'a' } } }
  assert.equal(schema.safeParse(ok).success, true)
  // enum rejects an out-of-set value
  assert.equal(schema.safeParse({ ...ok, sort: 'sideways' }).success, false)
  // a typed array rejects a wrong element type
  assert.equal(schema.safeParse({ ...ok, ids: ['nope'] }).success, false)
  // a nested required field is enforced
  assert.equal(schema.safeParse({ ...ok, body: { filter: {} } }).success, false)
})

test('input schema treats object without properties as freeform object', () => {
  const doc: OpenApiDoc = {
    openapi: '3.0.0',
    info: { title: 'Freeform API', version: '1.0.0' },
    paths: {
      '/freeform': {
        post: {
          operationId: 'freeform',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { type: 'object' } } },
          },
          responses: { '200': { description: 'ok' } },
        },
      },
    },
  }
  const [glyph] = glyphsFromOpenApi(doc, { baseUrl: 'https://x.test' })
  assert.equal(glyph.inputSchema.safeParse({ body: { a: 1, nested: { ok: true } } }).success, true)
  assert.equal(glyph.inputSchema.safeParse({ body: ['not', 'an', 'object'] }).success, false)
  assert.equal(glyph.inputSchema.safeParse({ body: 'not an object' }).success, false)
})

// ---- output validation against the declared response schema ----------------

const typedDoc: OpenApiDoc = {
  openapi: '3.0.0',
  info: { title: 'typed', version: '1' },
  paths: {
    '/widgets/{id}': {
      get: {
        operationId: 'getWidget',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'ok',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    weight: { type: 'integer' },
                  },
                  required: ['id', 'weight'],
                },
              },
            },
          },
        },
      },
    },
  },
}

test('output matching the declared response schema passes', () => {
  const [glyph] = glyphsFromOpenApi(typedDoc, { baseUrl: 'https://x.test' })
  const checked = glyph.outputSchema.safeParse({ id: 'a', weight: 3 })
  assert.equal(checked.success, true)
})

test('output violating the declared response schema is rejected', () => {
  const [glyph] = glyphsFromOpenApi(typedDoc, { baseUrl: 'https://x.test' })
  const checked = glyph.outputSchema.safeParse({ id: 'a', weight: 'heavy' })
  assert.equal(checked.success, false)
})

test("outputValidation: 'none' is opt-out", () => {
  const [glyph] = glyphsFromOpenApi(typedDoc, {
    baseUrl: 'https://x.test',
    outputValidation: 'none',
  })
  const checked = glyph.outputSchema.safeParse({ anything: 'goes' })
  assert.equal(checked.success, true)
})

// ---- header / cookie params + security schemes ----------------------------

const headerDoc: OpenApiDoc = {
  openapi: '3.0.0',
  info: { title: 't', version: '1' },
  paths: {
    '/items': {
      get: {
        operationId: 'listItems',
        parameters: [
          {
            name: 'X-Tenant',
            in: 'header',
            required: true,
            schema: { type: 'string' },
          },
          {
            name: 'session',
            in: 'cookie',
            required: false,
            schema: { type: 'string' },
          },
          {
            name: 'tag',
            in: 'query',
            required: false,
            schema: { type: 'array', items: { type: 'string' } },
          },
        ],
        responses: { '200': { description: 'ok' } },
      },
    },
  },
}

test('header params are forwarded to fetch', async () => {
  const [glyph] = glyphsFromOpenApi(headerDoc, { baseUrl: 'https://x.test' })
  let observed: { url: string; init: any } | null = null
  const realFetch = globalThis.fetch
  globalThis.fetch = (async (url: string, init: any) => {
    observed = { url, init }
    return { ok: true, status: 200, text: async () => '' } as any
  }) as any
  try {
    await glyph.handler(
      { 'X-Tenant': 'acme', session: 'abc', tag: ['a', 'b'] },
      {
        signal: new AbortController().signal,
      },
    )
  } finally {
    globalThis.fetch = realFetch
  }
  assert.ok(observed)
  assert.equal((observed as any).init.headers['X-Tenant'], 'acme')
  assert.equal((observed as any).init.headers.Cookie, 'session=abc')
  // array query expanded into repeated keys
  assert.match((observed as any).url, /tag=a&tag=b/)
})

test('security: bearer scheme adds Authorization header', async () => {
  const secDoc: OpenApiDoc = {
    openapi: '3.0.0',
    info: { title: 't', version: '1' },
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer' },
      },
    },
    security: [{ bearerAuth: [] }],
    paths: {
      '/me': {
        get: {
          operationId: 'me',
          responses: { '200': { description: 'ok' } },
        },
      },
    },
  }
  const [glyph] = glyphsFromOpenApi(secDoc, {
    baseUrl: 'https://x.test',
    security: { schemes: { bearerAuth: { type: 'bearer', token: 'tok123' } } },
  })
  let observed: any = null
  const realFetch = globalThis.fetch
  globalThis.fetch = (async (_url: string, init: any) => {
    observed = init
    return { ok: true, status: 200, text: async () => '' } as any
  }) as any
  try {
    await glyph.handler({}, { signal: new AbortController().signal })
  } finally {
    globalThis.fetch = realFetch
  }
  assert.equal(observed.headers.Authorization, 'Bearer tok123')
})

test('security: apiKey-in-header scheme adds custom header', async () => {
  const secDoc: OpenApiDoc = {
    openapi: '3.0.0',
    info: { title: 't', version: '1' },
    components: {
      securitySchemes: {
        apiKey: { type: 'apiKey', in: 'header', name: 'X-Api-Key' },
      },
    },
    security: [{ apiKey: [] }],
    paths: {
      '/x': {
        get: { operationId: 'x', responses: { '200': { description: 'ok' } } },
      },
    },
  }
  const [glyph] = glyphsFromOpenApi(secDoc, {
    baseUrl: 'https://x.test',
    security: { schemes: { apiKey: { type: 'apiKey', value: 'k-1' } } },
  })
  let observed: any = null
  const realFetch = globalThis.fetch
  globalThis.fetch = (async (_url: string, init: any) => {
    observed = init
    return { ok: true, status: 200, text: async () => '' } as any
  }) as any
  try {
    await glyph.handler({}, { signal: new AbortController().signal })
  } finally {
    globalThis.fetch = realFetch
  }
  assert.equal(observed.headers['X-Api-Key'], 'k-1')
})

test('baseUrl from doc.servers[0].url requires explicit opt-in', () => {
  const doc: OpenApiDoc = {
    openapi: '3.0.0',
    info: { title: 't', version: '1' },
    servers: [{ url: 'https://from-servers.test' }],
    paths: {
      '/x': {
        get: { operationId: 'x', responses: { '200': { description: 'ok' } } },
      },
    },
  }
  // Without allowDocumentServerUrl, the implicit server URL is refused as SSRF vector.
  assert.throws(() => glyphsFromOpenApi(doc, {} as any), /baseUrl|SSRF|opt.?in/)
  // With the opt-in, it works.
  const glyphs = glyphsFromOpenApi(doc, { allowDocumentServerUrl: true })
  assert.equal(glyphs.length, 1)
})

test('missing baseUrl and missing servers[] throws at adapt time', () => {
  const doc: OpenApiDoc = {
    openapi: '3.0.0',
    info: { title: 't', version: '1' },
    paths: {
      '/x': {
        get: { operationId: 'x', responses: { '200': { description: 'ok' } } },
      },
    },
  }
  assert.throws(() => glyphsFromOpenApi(doc, {} as any))
})
