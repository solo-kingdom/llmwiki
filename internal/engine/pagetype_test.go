package engine

import "testing"

func TestWikiPageType(t *testing.T) {
	tests := []struct {
		path string
		want string
	}{
		{"wiki/entities/foo.md", "entity"},
		{"wiki/concepts/bar.md", "concept"},
		{"wiki/sources/s.md", "source"},
		{"wiki/other.md", "page"},
	}
	for _, tc := range tests {
		if got := WikiPageType(tc.path); got != tc.want {
			t.Errorf("WikiPageType(%q) = %q, want %q", tc.path, got, tc.want)
		}
	}
}
