## What

<!-- One paragraph: what changed, who it helps, and why it matters. -->

## Checklist

- [ ] `pnpm verify` passes (typecheck + tests + build + conformance)
- [ ] `pnpm verify:full` passes if cross-SDK changes (Python / Go)
- [ ] An RFC under `spec/rfcs/` is included when this PR changes the wire (new endpoints, error codes, schema fields, hashing or signature rules, key/identity model, conformance level semantics)
- [ ] Schema vectors under `spec/schemas/` are updated when schema fields change
- [ ] Cross-SDK canonical test vectors under `spec/canonical/` are regenerated when hashing/signing/sanitization logic changes (`pnpm exec node scripts/generate-vectors.mjs`)
- [ ] Tests live next to the package (`packages/<name>/test/`) and cover the new behaviour

## Review path

<!-- Help the reviewer: what to read first, what is intentionally out of scope, and links to the previous/next PR when work is chained. -->

## Next step

<!-- Link or action that continues the workflow after merge. -->
