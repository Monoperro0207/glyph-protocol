# 06 — Cross-language verification

Demonstrates that a card signed in TypeScript verifies bit-identically in
Python and Go using the canonical test vectors under
[`spec/canonical/`](../../spec/canonical/).

## Run it

```bash
# TypeScript
pnpm test --filter @glyphp/core

# Python (from repo root, after `pip install -e ./sdks/python[test]`)
( cd sdks/python && python -m pytest -q )

# Go (after `go install golang.org/dl/go1.22@latest`)
( cd sdks/go/glyphprotocol && go test ./... )
```

All three suites consume the same `spec/canonical/*-vectors.json` files.
If one SDK ever drifts, its tests fail loudly — the vectors are the
single source of truth.

## What is verified

- **canonicalize** — identical canonical UTF-8 bytes across SDKs.
- **hashing** — identical SHA-256 hex.
- **signatures** — identical ed25519 signatures (ed25519 is
  deterministic, so a fixed key + fixed message always produces the
  same bytes).
- **sanitize** — identical inspection report and identical cleaned
  output for every fixture string.

When all three SDKs agree on the bytes, a card signed in one verifies in
any of the others without re-implementing the protocol.

## Regenerating the vectors

```bash
node scripts/generate-vectors.mjs
```

This rewrites every file under `spec/canonical/`. The TS / Python / Go
test suites should immediately fail if the vectors drift from the SDKs'
implementations — fix the SDKs, not the vectors.
