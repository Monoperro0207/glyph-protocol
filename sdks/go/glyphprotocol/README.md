# glyphprotocol — Go SDK

Verify Glyph Protocol cards, receipts and key registries from Go.
Implements Glyph Protocol 1.0; uses the Go standard library only
(`crypto/ed25519`, `crypto/sha256`, `encoding/json`, `net/http`).

## Install

```bash
go get github.com/Monoperro0207/glyph-protocol/sdks/go/glyphprotocol
```

## Verify a card

```go
import "github.com/Monoperro0207/glyph-protocol/sdks/go/glyphprotocol"

card, _ := glyphprotocol.FetchCard("https://example.com", "refund-payment")
if ok, _ := glyphprotocol.VerifyGlyph(card); !ok {
    panic("card did not verify")
}
```

## Cross-language compatibility

The Go SDK is tested against the canonical test vectors in
`spec/canonical/*-vectors.json` — so a value canonicalized or signed in Go
verifies bit-identical to its TypeScript and Python counterparts.

Run `go test ./...` from this directory to verify.
