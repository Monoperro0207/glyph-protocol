# Versioning matrix

Glyph Protocol coordinates several artifacts that ship at their own cadence: the
wire protocol, the TypeScript packages, the Python SDK on PyPI, and the Go
module. This page is the single source of truth for which versions
interoperate.

## Current matrix

| Layer | Current version | Source |
|---|---|---|
| Wire protocol | **1.0** (stable) | [`spec/protocol.md`](../spec/protocol.md) |
| `@glyphp/core`, `@glyphp/client`, `@glyphp/server`, `@glyphp/resolver`, `@glyphp/types`, `@glyphp/conformance`, `@glyphp/adapter-mcp`, `@glyphp/adapter-mcp-server`, `@glyphp/adapter-openapi`, `@glyphp/cli` | **1.0.0** | [npm](https://www.npmjs.com/org/glyphp) |
| `@glyphp/integration-vercel-ai`, `@glyphp/integration-langchain`, `@glyphp/integration-llamaindex`, `@glyphp/integration-openai-agents` | **1.1.0** | [npm](https://www.npmjs.com/org/glyphp) |
| `glyph-protocol` (Python) | **1.0.0** | [PyPI](https://pypi.org/project/glyph-protocol/) |
| `github.com/Monoperro0207/glyph-protocol/sdks/go/glyphprotocol` | **v1.0.0** | [git tag](https://github.com/Monoperro0207/glyph-protocol/releases/tag/sdks%2Fgo%2Fglyphprotocol%2Fv1.0.0) |

## Compatibility statement

A consumer using **wire protocol 1.0** can talk to:
- any npm package on the **1.x** line of `@glyphp/*`,
- any `@glyphp/integration-*` package on the **1.x** line,
- the Python SDK on the **1.0.x** line,
- the Go SDK on the **v1.0.x** line.

```
wire 1.0  ↔  npm @glyphp/* 1.x  ↔  py glyph-protocol 1.0.x  ↔  go glyphprotocol v1.0.x
```

A handshake against a server speaking a different major wire protocol is
rejected at the `POST /handshake` step with `426 PROTOCOL_VERSION_UNSUPPORTED`.

## How each artifact is versioned

- **Wire protocol** uses an integer major number. Breaking changes bump the
  major; additive changes (new error codes, new optional fields, new endpoints
  that fall back gracefully when missing) stay on the same major. See
  [`CHANGELOG-PROTOCOL.md`](../CHANGELOG-PROTOCOL.md).
- **npm packages** follow [semver](https://semver.org/) and are released
  through Changesets. The published package metadata carries
  [npm provenance](https://docs.npmjs.com/generating-provenance-statements) via
  GitHub OIDC.
- **Python SDK** follows semver and is published to PyPI from CI.
- **Go SDK** follows Go module versioning under
  `sdks/go/glyphprotocol/v1.0.0` style tags.

## Upgrading

The minor and patch bumps inside each row above are non-breaking by policy. The
breaking changes that would force a major bump in the npm packages (or a new
wire-protocol number) are listed up-front in the changeset PR description and
in `CHANGELOG-PROTOCOL.md`. Consumers should pin to the major they target and
let minor/patch bumps in.
