# Verifying a Glyph release

Glyph releases use npm trusted publishing plus GitHub Release artifacts from
`.github/workflows/release.yml`.

## What to expect

1. **npm provenance** is expected for every published `@glyphp/*` package.
   It is produced by npm trusted publishing over GitHub OIDC and appears on the
   npm package page as provenance/attestation metadata.
2. **Core package SBOM + cosign** are required post-publish status checks for:
   `@glyphp/core`, `@glyphp/server`, `@glyphp/client`, and
   `@glyphp/conformance`. The packages cannot be unpublished by the workflow if
   attestation later fails, but the workflow fails and marks the release as
   missing required core attestations.
3. **Non-core package SBOM + cosign** are best-effort. Missing non-core SBOM or
   cosign assets should be treated as reduced provenance, not proof of
   tampering.

## Verifying npm provenance

```bash
npm view @glyphp/core dist.attestations
```

The package page on npmjs.com also displays a GitHub Actions provenance badge
when trusted publishing metadata is present.

## Verifying a cosign signature

```bash
# Replace these placeholders with the package and version you are verifying.
PACKAGE="@glyphp/core"
VERSION="<version>"
TAG="${PACKAGE}@${VERSION}"
PKG=$(node -p "require('path').basename(process.env.PACKAGE).replace('@','')")

gh release download "$TAG" \
  --pattern "${PKG}-${VERSION}.tgz" \
  --pattern "${PKG}-${VERSION}.cosign.bundle"

cosign verify-blob \
  --certificate-identity=https://github.com/Monoperro0207/glyph-protocol/.github/workflows/release.yml@refs/heads/main \
  --certificate-oidc-issuer=https://token.actions.githubusercontent.com \
  --bundle "${PKG}-${VERSION}.cosign.bundle" \
  "${PKG}-${VERSION}.tgz"
```

A successful verification prints `Verified OK` and exits zero.

## Inspecting the SBOM

```bash
gh release download "$TAG" --pattern "${PKG}-${VERSION}.cdx.sbom.json"
jq '.metadata.component' "${PKG}-${VERSION}.cdx.sbom.json"
jq '.components | length' "${PKG}-${VERSION}.cdx.sbom.json"
```

The SBOM follows CycloneDX 1.5+. Feed it to your dependency-scanning tool of
choice (Trivy, Grype, OWASP Dependency-Track, …) for CVE correlation.

## Why three?

- **npm provenance** is what most JS-native tooling checks first.
- **Cosign** is the cross-ecosystem signature — useful when verifying outside of
  an npm registry context (mirrors, air-gapped installs).
- **SBOM** is the inventory: it tells you what is in the package, independent of
  who signed it.

Together they answer: "Who built this? Are they who they say they are? What's
inside it?" — all without trusting any single registry.
