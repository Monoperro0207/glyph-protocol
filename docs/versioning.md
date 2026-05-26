# Versioning matrix

Glyph Protocol coordinates several artifacts that ship at their own cadence: the
wire protocol, TypeScript packages, the Python SDK on PyPI, and the Go module.
Use package metadata (`packages/*/package.json`, `sdks/python/pyproject.toml`,
and Go module tags) as the source of truth for exact release numbers.

## Current compatibility

| Layer | Compatibility line | Source |
|---|---|---|
| Wire protocol | **1.0** (stable) | [`spec/protocol.md`](../spec/protocol.md) |
| npm `@glyphp/*` packages | **1.x** unless package metadata declares a newer major | `packages/*/package.json` + npm |
| `@glyphp/exporter-otel` | **0.x** additive exporter package | `packages/exporter-otel/package.json` + npm |
| Python `glyph-protocol` | **1.0.x** | [`sdks/python/pyproject.toml`](../sdks/python/pyproject.toml) + PyPI |
| Go `glyphprotocol` module | **v1.0.x** | `sdks/go/glyphprotocol` tags |

## Compatibility statement

A consumer using **wire protocol 1.0** can talk to:

- npm packages on their compatible **1.x** line unless a package intentionally
  declared a newer major for package-level behavior,
- integration packages on the **1.x** line,
- `@glyphp/exporter-otel` on the **0.x** line,
- the Python SDK on the **1.0.x** line,
- the Go SDK on the **v1.0.x** line.

```text
wire 1.0  ↔  npm @glyphp/* compatible lines  ↔  py glyph-protocol 1.0.x  ↔  go glyphprotocol v1.0.x
```

A handshake against a server speaking a different major wire protocol is
rejected at the `POST /handshake` step with `426 PROTOCOL_VERSION_UNSUPPORTED`.

## How each artifact is versioned

- **Wire protocol** uses an integer major number. Breaking changes bump the
  major; additive changes (new error codes, new optional fields, new endpoints
  that fall back gracefully when missing) stay on the same major. See
  [`CHANGELOG-PROTOCOL.md`](../CHANGELOG-PROTOCOL.md).
- **npm packages** follow [semver](https://semver.org/) and are released
  through Changesets. The published package metadata carries npm provenance via
  GitHub OIDC.
- **Python SDK** follows semver and is published to PyPI through the approved
  release path.
- **Go SDK** follows Go module versioning under
  `sdks/go/glyphprotocol/vX.Y.Z` style tags.

## Keeping this page current

Do not hardcode patch/minor package versions here. Exact numbers drift every
Changesets release; link to package metadata instead. If a compatibility line
changes, update this page in the same PR as the major/wire compatibility change.
