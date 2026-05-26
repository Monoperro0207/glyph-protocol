package glyphprotocol

import (
	"sort"
	"strings"
	"unicode"

	"golang.org/x/text/unicode/norm"
)

// SanitizationFinding mirrors @glyphp/types.SanitizationFinding.
type SanitizationFinding struct {
	Path  string `json:"path"`
	Kind  string `json:"kind"`
	Count int    `json:"count"`
}

// SanitizationReport mirrors @glyphp/types.Sanitization.
type SanitizationReport struct {
	Modified bool                  `json:"modified"`
	Findings []SanitizationFinding `json:"findings"`
}

// SanitizeResult is the return value of Sanitize.
type SanitizeResult struct {
	Value  any                `json:"value"`
	Report SanitizationReport `json:"report"`
}

func escapePathToken(token string) string {
	token = strings.ReplaceAll(token, "~", "~0")
	return strings.ReplaceAll(token, "/", "~1")
}

func isTag(r rune) bool        { return r >= 0xE0000 && r <= 0xE007F }
func isZeroWidth(r rune) bool {
	switch r {
	case 0x200B, 0x200C, 0x200D, 0x2060, 0xFEFF:
		return true
	}
	return false
}
func isBidi(r rune) bool {
	switch r {
	case 0x202A, 0x202B, 0x202C, 0x202D, 0x202E, 0x2066, 0x2067, 0x2068, 0x2069:
		return true
	}
	return false
}
func isControl(r rune) bool {
	// C0 excluding tab/LF/CR, plus C1.
	if r == '\t' || r == '\n' || r == '\r' {
		return false
	}
	return (r >= 0x00 && r <= 0x1F) || (r >= 0x7F && r <= 0x9F)
}

func stripRunes(s string, match func(rune) bool) (string, int) {
	out := make([]rune, 0, len(s))
	count := 0
	for _, r := range s {
		if match(r) {
			count++
			continue
		}
		out = append(out, r)
	}
	return string(out), count
}

func sanitizeString(s, path string) (string, []SanitizationFinding) {
	var findings []SanitizationFinding
	add := func(kind string, count int) {
		if count > 0 {
			findings = append(findings, SanitizationFinding{Path: path, Kind: kind, Count: count})
		}
	}
	cur, n := stripRunes(s, isTag)
	add("unicode-tags", n)
	cur, n = stripRunes(cur, isZeroWidth)
	add("zero-width", n)
	cur, n = stripRunes(cur, isBidi)
	add("bidi-override", n)
	cur, n = stripRunes(cur, isControl)
	add("control-char", n)
	nfkc := norm.NFKC.String(cur)
	if nfkc != cur {
		findings = append(findings, SanitizationFinding{Path: path, Kind: "nfkc-normalized", Count: 1})
		cur = nfkc
	}
	_ = unicode.IsLetter // keep unicode import meaningful
	return cur, findings
}

func sanitizeValue(value any, path string) (any, []SanitizationFinding) {
	switch v := value.(type) {
	case string:
		return sanitizeString(v, path)
	case []any:
		out := make([]any, len(v))
		var all []SanitizationFinding
		for i, item := range v {
			nv, f := sanitizeValue(item, path+"/"+itoa(i))
			out[i] = nv
			all = append(all, f...)
		}
		return out, all
	case map[string]any:
		out := make(map[string]any, len(v))
		var all []SanitizationFinding
		for k, item := range v {
			nv, f := sanitizeValue(item, path+"/"+escapePathToken(k))
			out[k] = nv
			all = append(all, f...)
		}
		return out, all
	default:
		return v, nil
	}
}

// Sanitize strips provably invisible / dangerous Unicode from every string
// in `value`, then applies NFKC normalisation. Mirrors @glyphp/core.sanitize.
func Sanitize(value any) SanitizeResult {
	out, findings := sanitizeValue(value, "")
	sort.SliceStable(findings, func(i, j int) bool {
		if findings[i].Path != findings[j].Path {
			return findings[i].Path < findings[j].Path
		}
		return findings[i].Kind < findings[j].Kind
	})
	if findings == nil {
		findings = []SanitizationFinding{}
	}
	return SanitizeResult{Value: out, Report: SanitizationReport{Modified: len(findings) > 0, Findings: findings}}
}

func itoa(i int) string {
	// Local minimal integer-to-decimal to avoid pulling strconv into the
	// public API surface in this file.
	if i == 0 {
		return "0"
	}
	neg := false
	if i < 0 {
		neg = true
		i = -i
	}
	var buf [20]byte
	pos := len(buf)
	for i > 0 {
		pos--
		buf[pos] = byte('0' + i%10)
		i /= 10
	}
	if neg {
		pos--
		buf[pos] = '-'
	}
	return string(buf[pos:])
}
