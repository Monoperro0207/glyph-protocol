import assert from 'node:assert/strict'
import { test } from 'node:test'
import { compileJsonSchema, SchemaCompilationError } from '../src/json-schema-validator.js'

// --- helpers ---

/**
 * Builds a schema with exactly `count` allOf items, each contributing
 * ~3 nodes (the item object, its properties, a field value object).
 * The outer wrapper adds another ~3 nodes. Total nodes ≈ 3*count + 3.
 */
function buildManyNodes(count: number): object {
  const items = Array.from({ length: count }, (_, i) => ({
    type: 'object' as const,
    properties: {
      [`field${i}`]: { type: 'integer' as const },
    },
  }))
  return {
    type: 'object',
    allOf: items,
  }
}

/**
 * Builds a schema with the given nesting depth. Each level is:
 *   { type: 'object', properties: { nested: <next> } }
 * Leaf at depth 0 is { type: 'string' }.
 */
function buildDeepSchema(depth: number): object {
  if (depth <= 0) return { type: 'string' }
  return {
    type: 'object',
    properties: {
      nested: buildDeepSchema(depth - 1),
    },
  }
}

// --- tests ---

test('schema with > 1000 total nodes throws SCHEMA_TOO_COMPLEX', () => {
  // 335 items × ~3 nodes each ≈ 1005 nodes + outer wrapper > 1000 limit
  const schema = buildManyNodes(335)
  assert.throws(
    () => compileJsonSchema(schema),
    (err: Error) => err.message.includes('SCHEMA_TOO_COMPLEX') || /too complex/i.test(err.message),
  )
})

test('schema with > 32 depth throws SCHEMA_TOO_COMPLEX', () => {
  const schema = buildDeepSchema(50)
  assert.throws(
    () => compileJsonSchema(schema),
    (err: Error) => err.message.includes('SCHEMA_TOO_COMPLEX') || /too complex/i.test(err.message),
  )
})

test('valid schema compiles without error', () => {
  const schema = {
    type: 'object',
    properties: {
      name: { type: 'string' },
      age: { type: 'integer' },
    },
    required: ['name'],
  }
  const validator = compileJsonSchema(schema)
  assert.ok(typeof validator.safeParse === 'function')
  assert.equal(validator.safeParse({ name: 'test', age: 30 }).success, true)
  assert.equal(validator.safeParse({ age: 30 }).success, false)
})

test('empty/absent schema still passes through', () => {
  const validator = compileJsonSchema({})
  assert.equal(validator.safeParse('anything').success, true)
})

// --- SCHEMALIMIT-COMPILE-001: fail-fast on uncompileable schemas ---

test('invalid schema that AJV cannot compile throws SchemaCompilationError', () => {
  // A pattern with an unterminated character class causes new RegExp("[") to
  // throw, which AJV propagates during compile().
  const badSchema = { type: 'string', pattern: '[' }
  assert.throws(() => compileJsonSchema(badSchema), SchemaCompilationError)
  // Also verify the error message mentions the failure
  assert.throws(
    () => compileJsonSchema(badSchema),
    (err: Error) =>
      err instanceof SchemaCompilationError && err.message.includes('SCHEMA_COMPILATION_FAILED'),
  )
})

test('outputValidation: none returns z.unknown() passthrough for bad schema', () => {
  const badSchema = { type: 'string', pattern: '[' }
  const validator = compileJsonSchema(badSchema, { outputValidation: 'none' })
  assert.equal(typeof validator.safeParse, 'function')
  // Passthrough: accepts anything
  assert.equal(validator.safeParse('anything').success, true)
  assert.equal(validator.safeParse(42).success, true)
  assert.equal(validator.safeParse({ complex: true }).success, true)
})

test('outputValidation: none returns z.unknown() passthrough even for valid schema', () => {
  const schema = { type: 'object', properties: { name: { type: 'string' } } }
  const validator = compileJsonSchema(schema, { outputValidation: 'none' })
  // Passthrough: accepts anything, doesn't validate
  assert.equal(validator.safeParse({ name: 'test' }).success, true)
  assert.equal(validator.safeParse(123).success, true)
})

test('another invalid schema (bad regex escape) also throws SchemaCompilationError', () => {
  // Single backslash is an invalid regex escape — AJV throws
  const badSchema = { type: 'string', pattern: '\\' }
  assert.throws(() => compileJsonSchema(badSchema), SchemaCompilationError)
  assert.throws(
    () => compileJsonSchema(badSchema),
    (err: Error) =>
      err instanceof SchemaCompilationError && err.message.includes('SCHEMA_COMPILATION_FAILED'),
  )
})

test('compileJsonSchema includes the underlying AJV error as cause', () => {
  const badSchema = { type: 'string', pattern: '[' }
  try {
    compileJsonSchema(badSchema)
    assert.fail('Expected SchemaCompilationError to be thrown')
  } catch (err) {
    assert.ok(err instanceof SchemaCompilationError)
    assert.ok((err as SchemaCompilationError).cause instanceof Error)
    assert.ok((err as SchemaCompilationError).cause!.message.includes('character class'))
  }
})
