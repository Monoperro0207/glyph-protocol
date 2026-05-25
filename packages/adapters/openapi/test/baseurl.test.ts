import assert from 'node:assert/strict'
import { test } from 'node:test'
import { glyphsFromOpenApi } from '../src/index.js'
import type { OpenApiDoc } from '../src/openapi-types.js'

const baseDoc: OpenApiDoc = {
  openapi: '3.0.0',
  info: { title: 'test', version: '1.0.0' },
  paths: {
    '/items': {
      get: {
        operationId: 'listItems',
        responses: { '200': { description: 'ok' } },
      },
    },
  },
}

test('refuse implicit document URL by default', () => {
  const doc: OpenApiDoc = {
    ...baseDoc,
    servers: [{ url: 'http://attacker.example.com' }],
  }
  assert.throws(
    () => glyphsFromOpenApi(doc, {}),
    (err: Error) => /baseUrl|server.?url|SSRF|trusted|opt.?in|explicit/i.test(err.message),
  )
})

test('use explicit baseUrl regardless of spec content', () => {
  const doc: OpenApiDoc = {
    ...baseDoc,
    servers: [{ url: 'http://evil.example.com' }],
  }
  const glyphs = glyphsFromOpenApi(doc, { baseUrl: 'http://trusted.local' })
  assert.equal(glyphs.length, 1)
})

test('opt-in to document URL with allowDocumentServerUrl', () => {
  const doc: OpenApiDoc = {
    ...baseDoc,
    servers: [{ url: 'http://safe.local' }],
  }
  const glyphs = glyphsFromOpenApi(doc, { allowDocumentServerUrl: true })
  assert.equal(glyphs.length, 1)
})

test('explicit baseUrl still works without allowDocumentServerUrl', () => {
  // No servers[] in this doc — explicit baseUrl should be enough
  const glyphs = glyphsFromOpenApi(baseDoc, { baseUrl: 'http://explicit.test' })
  assert.equal(glyphs.length, 1)
})

test('allowedHosts filter rejects unknown hosts from document URL', () => {
  const doc: OpenApiDoc = {
    ...baseDoc,
    servers: [{ url: 'http://attacker.example.com' }],
  }
  assert.throws(
    () =>
      glyphsFromOpenApi(doc, {
        allowDocumentServerUrl: true,
        allowedHosts: ['safe.local'],
      }),
    (err: Error) => /host|allowed|not in/i.test(err.message),
  )
})

test('allowedHosts filter accepts known host from document URL', () => {
  const doc: OpenApiDoc = {
    ...baseDoc,
    servers: [{ url: 'http://safe.local' }],
  }
  const glyphs = glyphsFromOpenApi(doc, {
    allowDocumentServerUrl: true,
    allowedHosts: ['safe.local'],
  })
  assert.equal(glyphs.length, 1)
})
