---
'@glyphp/core': minor
---

Add `validateSchemaComplexity()` — a recursive pre-compile guard that rejects JSON Schemas with more than 1000 nodes or deeper than 32 levels before they reach AJV. Schemas exceeding the limit throw `SchemaComplexityError` with `code: 'SCHEMA_TOO_COMPLEX'`. Valid schemas pass through without change. This protects against adversarial schemas imported via the OpenAPI or MCP adapters.
