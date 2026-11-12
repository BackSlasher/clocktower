package room

import (
	"strings"
	"testing"
)

func TestCodes(t *testing.T) {
	seen := map[string]bool{}
	for i := 0; i < 2000; i++ {
		c := newCode()
		if len(c) != 4 || strings.ContainsAny(c, "IO") || rude[c] || NormalizeCode(c) != c {
			t.Fatalf("bad code %q", c)
		}
		seen[c] = true
	}
	if len(seen) < 1900 {
		t.Fatalf("codes not random enough: %d unique", len(seen))
	}
	for in, want := range map[string]string{"abcd": "ABCD", " wxyz ": "WXYZ", "AB1D": "", "ABCDE": "", "": "", "ÄBCD": ""} {
		if got := NormalizeCode(in); got != want {
			t.Errorf("NormalizeCode(%q) = %q want %q", in, got, want)
		}
	}
	if a, b := newToken(), newToken(); a == b || len(a) < 20 {
		t.Fatal("tokens")
	}
}
