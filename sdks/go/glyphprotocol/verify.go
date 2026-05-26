package glyphprotocol

import (
	"crypto/ed25519"
	"encoding/hex"
	"errors"
)

// Verify a card's content hash and ed25519 signature. Returns (ok, error)
// — error is non-nil only for malformed inputs (hex decode failures);
// returning (false, nil) means the signature simply did not verify.
func VerifyGlyph(card map[string]any) (bool, error) {
	pub, _ := card["publicKey"].(string)
	sig, _ := card["signature"].(string)
	id, _ := card["id"].(string)
	if pub == "" || sig == "" || id == "" {
		return false, nil
	}
	expected, err := computeGlyphID(card)
	if err != nil {
		return false, err
	}
	if expected != id {
		return false, nil
	}
	return verifyEd25519(pub, []byte(expected), sig)
}

// VerifyReceipt verifies a CallReceipt against its embedded serverPublicKey.
func VerifyReceipt(receipt map[string]any) (bool, error) {
	pub, _ := receipt["serverPublicKey"].(string)
	sig, _ := receipt["signature"].(string)
	if pub == "" || sig == "" {
		return false, nil
	}
	base := copyWithout(receipt, "signature")
	hash, err := CanonicalHash(base)
	if err != nil {
		return false, err
	}
	return verifyEd25519(pub, []byte(hash), sig)
}

// VerifyManifest verifies an UpdateManifest against its embedded serverPublicKey.
func VerifyManifest(manifest map[string]any) (bool, error) {
	pub, _ := manifest["serverPublicKey"].(string)
	sig, _ := manifest["signature"].(string)
	if pub == "" || sig == "" {
		return false, nil
	}
	base := copyWithout(manifest, "signature")
	hash, err := CanonicalHash(base)
	if err != nil {
		return false, err
	}
	return verifyEd25519(pub, []byte(hash), sig)
}

// VerifyKeyRegistry verifies a registry's chain-of-trust and outer signature.
func VerifyKeyRegistry(registry map[string]any) (bool, error) {
	if v, _ := registry["registryVersion"].(string); v != "1.0" {
		return false, nil
	}
	rawKeys, _ := registry["keys"].([]any)
	if len(rawKeys) == 0 {
		return false, nil
	}
	byFp := map[string]map[string]any{}
	for _, raw := range rawKeys {
		entry, _ := raw.(map[string]any)
		pub, _ := entry["publicKey"].(string)
		fp, _ := entry["fingerprint"].(string)
		if FingerprintKey(pub) != fp {
			return false, nil
		}
		byFp[fp] = entry
	}
	for _, raw := range rawKeys {
		entry, _ := raw.(map[string]any)
		signedBy, _ := entry["signedBy"].(string)
		if signedBy == "" {
			continue
		}
		sig, _ := entry["signature"].(string)
		if sig == "" {
			return false, nil
		}
		parent, ok := byFp[signedBy]
		if !ok {
			return false, nil
		}
		payload, err := CanonicalHash(map[string]any{
			"fingerprint": entry["fingerprint"],
			"publicKey":   entry["publicKey"],
			"validFrom":   entry["validFrom"],
			"signedBy":    entry["signedBy"],
		})
		if err != nil {
			return false, err
		}
		ok2, err := verifyEd25519(parent["publicKey"].(string), []byte(payload), sig)
		if err != nil {
			return false, err
		}
		if !ok2 {
			return false, nil
		}
	}
	activeFp, _ := registry["active"].(string)
	active, ok := byFp[activeFp]
	if !ok {
		return false, nil
	}
	if _, revoked := active["revokedAt"]; revoked {
		return false, nil
	}
	payload, err := CanonicalHash(map[string]any{
		"registryVersion": registry["registryVersion"],
		"serverId":        registry["serverId"],
		"active":          registry["active"],
		"keys":            registry["keys"],
		"issuedAt":        registry["issuedAt"],
		"ttlSeconds":      registry["ttlSeconds"],
	})
	if err != nil {
		return false, err
	}
	outerSig, _ := registry["signature"].(string)
	return verifyEd25519(active["publicKey"].(string), []byte(payload), outerSig)
}

// ResolveResult mirrors @glyphp/core.ResolveResult.
type ResolveResult struct {
	Status string         // "active" | "retired" | "revoked" | "unknown"
	Entry  map[string]any // nil when Status == "unknown"
	Reason string         // populated when Status == "revoked"
}

// ResolveKey returns the registry's status for a given hex public key.
func ResolveKey(registry map[string]any, publicKeyHex string) ResolveResult {
	target := FingerprintKey(publicKeyHex)
	rawKeys, _ := registry["keys"].([]any)
	for _, raw := range rawKeys {
		entry, _ := raw.(map[string]any)
		fp, _ := entry["fingerprint"].(string)
		if fp != target {
			continue
		}
		if revoked, _ := entry["revokedAt"].(string); revoked != "" {
			reason, _ := entry["revocationReason"].(string)
			return ResolveResult{Status: "revoked", Entry: entry, Reason: reason}
		}
		if validUntil, _ := entry["validUntil"].(string); validUntil != "" {
			return ResolveResult{Status: "retired", Entry: entry}
		}
		return ResolveResult{Status: "active", Entry: entry}
	}
	return ResolveResult{Status: "unknown"}
}

// ---- internals -----------------------------------------------------------

var cardCanonicalFields = []string{
	"version", "name", "intent", "tags", "cost", "idempotent",
	"input", "output", "examples", "failureModes", "provider", "requiredScopes", "attestation",
}

func computeGlyphID(card map[string]any) (string, error) {
	picked := map[string]any{}
	for _, f := range cardCanonicalFields {
		if v, ok := card[f]; ok {
			picked[f] = v
		}
	}
	return CanonicalHash(picked)
}

func copyWithout(m map[string]any, key string) map[string]any {
	out := make(map[string]any, len(m))
	for k, v := range m {
		if k == key {
			continue
		}
		out[k] = v
	}
	return out
}

func verifyEd25519(publicKeyHex string, message []byte, signatureHex string) (bool, error) {
	pubBytes, err := hex.DecodeString(publicKeyHex)
	if err != nil {
		return false, err
	}
	if len(pubBytes) != ed25519.PublicKeySize {
		return false, errors.New("ed25519: invalid public key length")
	}
	sigBytes, err := hex.DecodeString(signatureHex)
	if err != nil {
		return false, err
	}
	if len(sigBytes) != ed25519.SignatureSize {
		return false, nil
	}
	return ed25519.Verify(ed25519.PublicKey(pubBytes), message, sigBytes), nil
}
