// Package glyphprotocol — canonicalisation, hashing, fingerprints.
//
// These functions mirror @glyphp/core exactly and are verified against
// `spec/canonical/*-vectors.json` so cross-SDK hashes and signatures match
// byte for byte.
package glyphprotocol

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"sort"
)

// Canonicalize returns a value with all map keys recursively sorted so a
// `json.Marshal` of the result is the canonical pre-image of the SHA-256
// hash. Arrays preserve order; scalars are returned as-is.
func Canonicalize(value any) any {
	switch v := value.(type) {
	case map[string]any:
		keys := make([]string, 0, len(v))
		for k := range v {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		out := make(map[string]any, len(v))
		for _, k := range keys {
			out[k] = Canonicalize(v[k])
		}
		return out
	case []any:
		out := make([]any, len(v))
		for i, item := range v {
			out[i] = Canonicalize(item)
		}
		return out
	default:
		return v
	}
}

// CanonicalBytes returns the canonical UTF-8 JSON encoding of `value` —
// without HTML escaping or trailing newline — matching Node's JSON.stringify
// defaults.
func CanonicalBytes(value any) ([]byte, error) {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(Canonicalize(value)); err != nil {
		return nil, err
	}
	// encoding/json appends a trailing newline; strip it to match JSON.stringify.
	out := buf.Bytes()
	if n := len(out); n > 0 && out[n-1] == '\n' {
		out = out[:n-1]
	}
	return out, nil
}

// CanonicalHash returns the SHA-256 hex of `CanonicalBytes(value)`.
func CanonicalHash(value any) (string, error) {
	b, err := CanonicalBytes(value)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:]), nil
}

// FingerprintKey returns sha256(hex(publicKey)) — the stable identifier used
// by KeyRegistry entries.
func FingerprintKey(publicKeyHex string) string {
	sum := sha256.Sum256([]byte(publicKeyHex))
	return hex.EncodeToString(sum[:])
}
