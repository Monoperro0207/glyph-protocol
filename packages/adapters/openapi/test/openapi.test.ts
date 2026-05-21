import { test } from 'node:test'
import assert from 'node:assert/strict'
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
  const names = glyphs().map((g) => g.card.name).sort()
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
