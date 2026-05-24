package glyphprotocol

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/hex"
	"testing"
)

func newKeyPair(t *testing.T) (pubHex string, priv ed25519.PrivateKey) {
	t.Helper()
	pub, p, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	return hex.EncodeToString(pub), p
}

func buildSignedCard(t *testing.T) (map[string]any, ed25519.PrivateKey) {
	pubHex, priv := newKeyPair(t)
	base := map[string]any{
		"version": "1.0.0",
		"name":    "echo",
		"intent":  "Echoes its input",
		"tags":    []any{},
		"cost": map[string]any{
			"latency":              "fast",
			"sideEffects":          false,
			"reversible":           true,
			"riskTier":             "safe",
			"requiresConfirmation": false,
		},
		"idempotent":   false,
		"input":        map[string]any{"type": "object"},
		"output":       map[string]any{"type": "object"},
		"examples":     []any{},
		"failureModes": []any{},
		"provider":     "test",
	}
	id, err := CanonicalHash(base)
	if err != nil {
		t.Fatal(err)
	}
	card := map[string]any{}
	for k, v := range base {
		card[k] = v
	}
	card["id"] = id
	card["publicKey"] = pubHex
	card["createdAt"] = "2026-01-01T00:00:00.000Z"
	card["signature"] = hex.EncodeToString(ed25519.Sign(priv, []byte(id)))
	return card, priv
}

func TestVerifyGlyphRoundTrip(t *testing.T) {
	card, _ := buildSignedCard(t)
	ok, err := VerifyGlyph(card)
	if err != nil {
		t.Fatal(err)
	}
	if !ok {
		t.Fatal("freshly built card did not verify")
	}
}

func TestVerifyGlyphDetectsTamper(t *testing.T) {
	card, _ := buildSignedCard(t)
	card["intent"] = "tampered"
	ok, _ := VerifyGlyph(card)
	if ok {
		t.Fatal("tampered card should not verify")
	}
}

func TestVerifyReceiptRoundTrip(t *testing.T) {
	pubHex, priv := newKeyPair(t)
	base := map[string]any{
		"receiptVersion":  "0.2",
		"callId":          "call-1",
		"glyphId":         "0000000000000000000000000000000000000000000000000000000000000000",
		"glyphName":       "echo",
		"inputHash":       "1111111111111111111111111111111111111111111111111111111111111111",
		"outputHash":      "2222222222222222222222222222222222222222222222222222222222222222",
		"inspectionHash":  "3333333333333333333333333333333333333333333333333333333333333333",
		"riskTier":        "safe",
		"provider":        "test",
		"latencyMs":       float64(5),
		"timestamp":       "2026-01-01T00:00:00.000Z",
		"serverPublicKey": pubHex,
	}
	hash, err := CanonicalHash(base)
	if err != nil {
		t.Fatal(err)
	}
	receipt := map[string]any{}
	for k, v := range base {
		receipt[k] = v
	}
	receipt["signature"] = hex.EncodeToString(ed25519.Sign(priv, []byte(hash)))
	ok, err := VerifyReceipt(receipt)
	if err != nil {
		t.Fatal(err)
	}
	if !ok {
		t.Fatal("receipt did not verify")
	}
}

func TestVerifyKeyRegistryGenesis(t *testing.T) {
	pubHex, priv := newKeyPair(t)
	fp := FingerprintKey(pubHex)
	entry := map[string]any{
		"fingerprint": fp,
		"publicKey":   pubHex,
		"validFrom":   "2026-01-01T00:00:00.000Z",
	}
	base := map[string]any{
		"registryVersion": "1.0",
		"serverId":        "test",
		"active":          fp,
		"keys":            []any{entry},
		"issuedAt":        "2026-01-01T00:00:00.000Z",
		"ttlSeconds":      float64(3600),
	}
	hash, err := CanonicalHash(base)
	if err != nil {
		t.Fatal(err)
	}
	registry := map[string]any{}
	for k, v := range base {
		registry[k] = v
	}
	registry["signature"] = hex.EncodeToString(ed25519.Sign(priv, []byte(hash)))
	ok, err := VerifyKeyRegistry(registry)
	if err != nil {
		t.Fatal(err)
	}
	if !ok {
		t.Fatal("genesis registry did not verify")
	}
	if got := ResolveKey(registry, pubHex); got.Status != "active" {
		t.Fatalf("ResolveKey: want active, got %s", got.Status)
	}
}
