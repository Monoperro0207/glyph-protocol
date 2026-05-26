---
'@glyphp/core': minor
---

`compileJsonSchema()` now throws `SchemaCompilationError` when a JSON Schema cannot be compiled by AJV, rather than silently degrading to `z.unknown()`. Add `outputValidation: 'none'` option as explicit opt-out for passthrough behavior. Export `SchemaCompilationError` and `CompileJsonSchemaOptions` types.
