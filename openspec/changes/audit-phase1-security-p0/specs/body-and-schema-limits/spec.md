# Delta for Body and Schema Limits

## ADDED Requirements

### Requirement: Schema Compilation Must Fail-Fast (SCHEMALIMIT-COMPILE-001)

When `compileJsonSchema()` encounters a schema that AJV cannot compile, it MUST throw a `SCHEMA_COMPILATION_FAILED` error rather than silently degrading to `z.unknown()` (passthrough). The absence of output validation MUST be visible and intentional. Passthrough behavior SHALL only be allowed via an explicit `outputValidation: 'none'` option, and the card or inspection report MUST flag that output validation is disabled.

#### Scenario: Invalid schema throws at adapt-time

- GIVEN a JSON Schema that AJV cannot compile (e.g., uses unsupported keywords or malformed constructs)
- WHEN `compileJsonSchema()` is called without `outputValidation: 'none'`
- THEN the function MUST throw `SCHEMA_COMPILATION_FAILED` immediately and MUST NOT return a validator

#### Scenario: Explicit opt-out allows passthrough

- GIVEN a JSON Schema that AJV cannot compile
- WHEN `compileJsonSchema()` is called with `outputValidation: 'none'`
- THEN the function returns a `z.unknown()` passthrough validator

#### Scenario: Disabled validation is flagged

- GIVEN a card created with `outputValidation: 'none'`
- WHEN the card or inspection report is generated
- THEN the report MUST indicate that output validation is disabled — such that consumers can detect the absence of validation

#### Scenario: Valid schema compiles normally

- GIVEN a JSON Schema that AJV can compile successfully
- WHEN `compileJsonSchema()` is called with default options
- THEN the schema compiles and returns a Zod validator — no error, no passthrough
