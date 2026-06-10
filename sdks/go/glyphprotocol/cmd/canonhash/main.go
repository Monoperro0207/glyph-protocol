// canonhash — differential-fuzzing runner for the Go SDK.
//
// Reads a JSON array of raw JSON texts on stdin and prints the CanonicalHash
// of each parsed value, one hex digest per line. Used by
// scripts/fuzz-canonical.mjs to compare canonicalization across SDKs.
package main

import (
	"encoding/json"
	"fmt"
	"io"
	"os"

	glyphprotocol "github.com/Monoperro0207/glyph-protocol/sdks/go/glyphprotocol"
)

func main() {
	raw, err := io.ReadAll(os.Stdin)
	if err != nil {
		fmt.Fprintln(os.Stderr, "canonhash: read stdin:", err)
		os.Exit(1)
	}
	var cases []string
	if err := json.Unmarshal(raw, &cases); err != nil {
		fmt.Fprintln(os.Stderr, "canonhash: stdin must be a JSON array of raw JSON strings:", err)
		os.Exit(1)
	}
	for i, c := range cases {
		var value any
		if err := json.Unmarshal([]byte(c), &value); err != nil {
			fmt.Fprintf(os.Stderr, "canonhash: case %d: bad JSON: %v\n", i, err)
			os.Exit(1)
		}
		hash, err := glyphprotocol.CanonicalHash(value)
		if err != nil {
			fmt.Fprintf(os.Stderr, "canonhash: case %d: %v\n", i, err)
			os.Exit(1)
		}
		fmt.Println(hash)
	}
}
