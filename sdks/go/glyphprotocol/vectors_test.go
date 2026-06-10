package glyphprotocol

import (
	"crypto/ed25519"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func vectorsDir(t *testing.T) string {
	t.Helper()
	// Walk up from this file (sdks/go/glyphprotocol) until we hit the repo root.
	cwd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	dir := cwd
	for i := 0; i < 10; i++ {
		candidate := filepath.Join(dir, "spec", "canonical")
		if _, err := os.Stat(candidate); err == nil {
			return candidate
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	t.Fatalf("could not find spec/canonical from %s", cwd)
	return ""
}

func loadVectors(t *testing.T, name string) map[string]any {
	t.Helper()
	path := filepath.Join(vectorsDir(t), name)
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var out map[string]any
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatal(err)
	}
	return out
}

// caseInput returns the case's input value. Cases carrying raw JSON text
// (`inputJson`) are parsed here, so this SDK's own parser + serializer are
// what the vector exercises (spec/protocol.md §8.1).
func caseInput(t *testing.T, c map[string]any) any {
	t.Helper()
	if rawJSON, ok := c["inputJson"].(string); ok {
		var v any
		if err := json.Unmarshal([]byte(rawJSON), &v); err != nil {
			t.Fatalf("%v: bad inputJson: %v", c["name"], err)
		}
		return v
	}
	return c["input"]
}

func TestCanonicalizeMatchesReference(t *testing.T) {
	cases := loadVectors(t, "canonicalize-vectors.json")["cases"].([]any)
	for _, raw := range cases {
		c := raw.(map[string]any)
		got, err := CanonicalBytes(caseInput(t, c))
		if err != nil {
			t.Fatalf("%v: %v", c["name"], err)
		}
		if string(got) != c["canonical"].(string) {
			t.Errorf("%v: canonical mismatch\n  want %q\n  got  %q", c["name"], c["canonical"], string(got))
		}
	}
}

func TestHashingMatchesReference(t *testing.T) {
	cases := loadVectors(t, "hashing-vectors.json")["cases"].([]any)
	for _, raw := range cases {
		c := raw.(map[string]any)
		got, err := CanonicalHash(caseInput(t, c))
		if err != nil {
			t.Fatalf("%v: %v", c["name"], err)
		}
		if got != c["sha256"].(string) {
			t.Errorf("%v: hash mismatch: want %s, got %s", c["name"], c["sha256"], got)
		}
	}
}

func TestSignatureMatchesReference(t *testing.T) {
	cases := loadVectors(t, "signature-vectors.json")["cases"].([]any)
	for _, raw := range cases {
		c := raw.(map[string]any)
		privSeed, err := hex.DecodeString(c["privateKey"].(string))
		if err != nil {
			t.Fatalf("%v: bad privateKey: %v", c["name"], err)
		}
		priv := ed25519.NewKeyFromSeed(privSeed)
		sig := ed25519.Sign(priv, []byte(c["message"].(string)))
		if hex.EncodeToString(sig) != c["signature"].(string) {
			t.Errorf("%v: signature mismatch", c["name"])
		}
		pubBytes, _ := hex.DecodeString(c["publicKey"].(string))
		if !ed25519.Verify(ed25519.PublicKey(pubBytes), []byte(c["message"].(string)), sig) {
			t.Errorf("%v: verify failed", c["name"])
		}
	}
}

func TestSanitizeMatchesReference(t *testing.T) {
	cases := loadVectors(t, "sanitize-vectors.json")["cases"].([]any)
	for _, raw := range cases {
		c := raw.(map[string]any)
		result := Sanitize(c["input"])

		// Compare value via JSON round-trip for stable equality across maps.
		gotJSON, _ := json.Marshal(result.Value)
		wantJSON, _ := json.Marshal(c["output"])
		if string(gotJSON) != string(wantJSON) {
			t.Errorf("%v: sanitized value mismatch\n  want %s\n  got  %s", c["name"], string(wantJSON), string(gotJSON))
		}

		// Compare report.
		gotReport, _ := json.Marshal(result.Report)
		wantReport, _ := json.Marshal(c["report"])
		// Decode both back into generic maps so map field order doesn't trip us.
		var g, w any
		_ = json.Unmarshal(gotReport, &g)
		_ = json.Unmarshal(wantReport, &w)
		if !reflect.DeepEqual(g, w) {
			t.Errorf("%v: report mismatch\n  want %s\n  got  %s", c["name"], string(wantReport), string(gotReport))
		}
	}
}
