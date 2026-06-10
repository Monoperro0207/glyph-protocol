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
	"fmt"
	"math"
	"sort"
	"unicode/utf16"
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

// utf16Less compares two strings by their UTF-16 code units — the JCS
// (RFC 8785) sort order, matching ECMAScript's default string comparison.
// It differs from Go's native byte/code-point order for keys containing
// characters above U+FFFF (surrogate pairs sort below U+E000–U+FFFF).
func utf16Less(a, b string) bool {
	ua := utf16.Encode([]rune(a))
	ub := utf16.Encode([]rune(b))
	for i := 0; i < len(ua) && i < len(ub); i++ {
		if ua[i] != ub[i] {
			return ua[i] < ub[i]
		}
	}
	return len(ua) < len(ub)
}

// appendJSONScalar encodes a single scalar with encoding/json semantics but
// without HTML escaping or the encoder's trailing newline.
func appendJSONScalar(buf *bytes.Buffer, v any) error {
	var tmp bytes.Buffer
	enc := json.NewEncoder(&tmp)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); err != nil {
		return err
	}
	out := tmp.Bytes()
	if n := len(out); n > 0 && out[n-1] == '\n' {
		out = out[:n-1]
	}
	buf.Write(out)
	return nil
}

// appendCanonical writes the RFC 8785 canonical JSON encoding of `value`.
// Numbers already serialize ECMAScript-style under encoding/json (shortest
// round-trip, exponent form outside [1e-6, 1e21), `1e-7` not `1e-07`) — the
// only divergences handled here are negative zero (JCS: `0`) and map key
// order (JCS: UTF-16 code units).
func appendCanonical(buf *bytes.Buffer, value any) error {
	switch v := value.(type) {
	case map[string]any:
		buf.WriteByte('{')
		keys := make([]string, 0, len(v))
		for k := range v {
			keys = append(keys, k)
		}
		sort.Slice(keys, func(i, j int) bool { return utf16Less(keys[i], keys[j]) })
		for i, k := range keys {
			if i > 0 {
				buf.WriteByte(',')
			}
			if err := appendJSONScalar(buf, k); err != nil {
				return err
			}
			buf.WriteByte(':')
			if err := appendCanonical(buf, v[k]); err != nil {
				return err
			}
		}
		buf.WriteByte('}')
		return nil
	case []any:
		buf.WriteByte('[')
		for i, item := range v {
			if i > 0 {
				buf.WriteByte(',')
			}
			if err := appendCanonical(buf, item); err != nil {
				return err
			}
		}
		buf.WriteByte(']')
		return nil
	case float64:
		if v == 0 {
			// Covers negative zero: JCS serializes -0 as 0.
			buf.WriteByte('0')
			return nil
		}
		if math.IsNaN(v) || math.IsInf(v, 0) {
			return fmt.Errorf("glyphprotocol: cannot canonicalize non-finite number %v", v)
		}
		return appendJSONScalar(buf, v)
	default:
		return appendJSONScalar(buf, v)
	}
}

// CanonicalBytes returns the canonical UTF-8 JSON encoding of `value` per
// RFC 8785 (JCS) — UTF-16-ordered keys, ECMAScript number formatting, no HTML
// escaping, no insignificant whitespace. See spec/protocol.md §8.1.
func CanonicalBytes(value any) ([]byte, error) {
	var buf bytes.Buffer
	if err := appendCanonical(&buf, value); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
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
