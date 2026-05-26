# Releasing Glyph Protocol after 1.0

This checklist covers ongoing releases after the stable wire-protocol 1.0 line.
Do not publish packages directly from a local checkout except for an explicitly
approved emergency or first-publish bootstrap.

## 0. Pre-flight

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm verify:full   # typecheck + test + build + smoke + conformance + python + go
pnpm audit --prod
```

All steps must pass. Fix any drift in `spec/canonical/*-vectors.json` by
re-running `node scripts/generate-vectors.mjs` and updating the corresponding
SDK if necessary.

## 1. Version packages

Add changesets with the user-facing package changes. The release workflow uses
Changesets on `main` after CI succeeds:

1. Merge feature/fix PRs with changesets.
2. The `Release` workflow opens or updates the Version Packages PR.
3. Review the generated versions/changelogs.
4. Merge the Version Packages PR when ready to publish.

Publishing then happens from `.github/workflows/release.yml` through npm trusted
publishing/OIDC. Do not run `pnpm release` locally for normal releases; local
publishing can bypass the provenance assumptions documented for consumers.

## 2. Python SDK

If the Python SDK changed, publish it through the project-approved release path.
For manual verification builds only:

```bash
cd sdks/python
python -m pip install --upgrade build twine
python -m build
```

Do not upload from a local machine unless explicitly approved.

## 3. Go SDK

Go modules publish by tag. For SDK releases, tag the exact release commit:

```bash
git tag sdks/go/glyphprotocol/v<version>
git push origin sdks/go/glyphprotocol/v<version>
```

The Go proxy picks the tag up automatically. Consumers run:

```bash
go get github.com/Monoperro0207/glyph-protocol/sdks/go/glyphprotocol@v<version>
```

## 4. Conformance badge for the reference server

Once a reference server is deployed, generate a public badge:

```bash
pnpm exec glyph-conformance https://reference.glyphprotocol.dev \
  --level all \
  --fixture-echo conformance-echo \
  --fixture-requires-confirmation conformance-requires-confirmation \
  --fixture-slow conformance-slow \
  --fixture-invalid-output conformance-invalid-output \
  --output report.json --markdown report.md
```

Commit `report.json` + `report.md` somewhere public and link from the top-level
README.

## 5. Post-release sanity checks

Verify npm provenance for at least one core package:

```bash
npm view @glyphp/core dist.attestations
```

Then follow `docs/release-verification.md` for cosign/SBOM checks on the
published package version.

In a clean directory outside the monorepo, run a smoke install against the
published packages:

```bash
mkdir -p /tmp/glyph-postrelease && cd /tmp/glyph-postrelease
npm init -y && npm pkg set type=module
npm i @glyphp/server@1 @glyphp/client@1 zod
node --input-type=module -e "
  import { GlyphServer, defineGlyph } from '@glyphp/server'
  import { GlyphClient } from '@glyphp/client'
  import { verifyReceipt } from '@glyphp/core'
  import { z } from 'zod'
  const g = defineGlyph({
    name: 'greet', intent: 'Greet',
    cost: { latency:'fast', sideEffects:false, reversible:true, riskTier:'safe', requiresConfirmation:false },
    input: z.object({ name: z.string() }),
    output: z.object({ msg: z.string() }),
    provider: 'pr', handler: async (i) => ({ msg: 'hi ' + i.name }),
  })
  const s = new GlyphServer({ port: 3201 })
  s.register(g); await s.start()
  const c = new GlyphClient({ baseUrl: 'http://localhost:3201' })
  await c.connect()
  const env = await c.call('greet', { name: 'world' })
  if (!verifyReceipt(env.receipt)) throw new Error('receipt failed')
  console.log('OK:', env.payload)
  process.exit(0)
"
```

Check SDK canonicalization in clean scratch projects:

```bash
python -m venv .venv && source .venv/bin/activate
pip install glyph-protocol
python -c "from glyph_protocol import canonical_hash; print(canonical_hash({'b':1,'a':2}))"
```

```bash
mkdir -p /tmp/glyph-go && cd /tmp/glyph-go
go mod init scratch
go get github.com/Monoperro0207/glyph-protocol/sdks/go/glyphprotocol@v<version>
cat > main.go <<'EOF'
package main
import (
  "fmt"
  glyph "github.com/Monoperro0207/glyph-protocol/sdks/go/glyphprotocol"
)
func main() {
  h, _ := glyph.CanonicalHash(map[string]any{"b": 1, "a": 2})
  fmt.Println(h)
}
EOF
go run .
```
