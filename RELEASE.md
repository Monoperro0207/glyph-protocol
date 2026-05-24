# Releasing Glyph Protocol 1.0

This checklist takes the repo from a green `pnpm verify:full` to a
published 1.0 across npm, PyPI and Go modules.

## 0. Pre-flight

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm verify:full   # typecheck + test + build + smoke + conformance + python + go
```

All steps must pass. Fix any drift in `spec/canonical/*-vectors.json` by
re-running `node scripts/generate-vectors.mjs` and updating the
corresponding SDK if necessary.

## 1. Wire-protocol bump (npm packages)

The `.changeset/protocol-1-0.md` file already exists and marks every
package as `major`. To produce the version bumps:

```bash
pnpm version-packages          # rewrites package.json versions
git commit -am "1.0 release"
```

Then publish:

```bash
pnpm release                   # pnpm build && changeset publish
```

`@glyphp/types` exports `PROTOCOL_VERSION`. Before the very first 1.0
release, change it from `0.2` to `1.0` in `packages/types/src/protocol.ts`
and update the server / conformance tests' expectations in the same
commit. (The 0.2 → 1.0 wire bump is intentional and breaking — clients
must opt in via the handshake.)

## 2. Python SDK (PyPI)

```bash
cd sdks/python
python -m pip install --upgrade build twine
python -m build
python -m twine upload dist/*
```

The package name is `glyph-protocol`; the import path is
`glyph_protocol`.

## 3. Go SDK (Go module proxy)

Go modules publish by tag. Tag the commit:

```bash
git tag sdks/go/glyphprotocol/v1.0.0
git push origin sdks/go/glyphprotocol/v1.0.0
```

The Go proxy picks the tag up automatically. Consumers run:

```bash
go get github.com/Monoperro0207/glyph-protocol/sdks/go/glyphprotocol@v1.0.0
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

Commit `report.json` + `report.md` somewhere public and link from the
top-level README.

## 5. GitHub release

```bash
git tag v1.0.0
git push origin v1.0.0
gh release create v1.0.0 --notes-file CHANGELOG-PROTOCOL.md
```

## 6. Post-release sanity check

In a clean directory, outside the monorepo:

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

```bash
python -m venv .venv && source .venv/bin/activate
pip install glyph-protocol
python -c "from glyph_protocol import canonical_hash; print(canonical_hash({'b':1,'a':2}))"
```

```bash
mkdir -p /tmp/glyph-go && cd /tmp/glyph-go
go mod init scratch
go get github.com/Monoperro0207/glyph-protocol/sdks/go/glyphprotocol@v1.0.0
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

All three printouts must match the same hash hex —
that is the end-to-end cross-language guarantee.
