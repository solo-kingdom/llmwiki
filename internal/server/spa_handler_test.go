package server

import (
	"io/fs"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

func TestSPAHandler_FallbackRoutes(t *testing.T) {
	sub, err := fs.Sub(mustWebDist(t), "dist")
	if err != nil {
		t.Fatal(err)
	}
	orig := WebAssets
	WebAssets = sub
	t.Cleanup(func() { WebAssets = orig })

	s := &Server{}
	handler := s.spaHandler()

	cases := []struct {
		path       string
		wantStatus int
		wantBody   string
		wantLoc    string
	}{
		{"/", http.StatusOK, "<!doctype html>", ""},
		{"/jobs", http.StatusOK, "<!doctype html>", ""},
		{"/settings", http.StatusOK, "<!doctype html>", ""},
		{"/wiki", http.StatusOK, "<!doctype html>", ""},
		{"/assets/", 0, "", ""}, // prefix match; exact asset checked below
	}

	for _, tc := range cases {
		t.Run(tc.path, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, tc.path, nil)
			rec := httptest.NewRecorder()
			handler(rec, req)

			if tc.wantStatus != 0 && rec.Code != tc.wantStatus {
				t.Fatalf("status = %d, want %d, Location=%q; body head: %q",
					rec.Code, tc.wantStatus, rec.Header().Get("Location"), rec.Body.String()[:min(80, rec.Body.Len())])
			}
			if tc.wantBody != "" && !strings.Contains(strings.ToLower(rec.Body.String()), tc.wantBody) {
				t.Fatalf("body missing %q: %q", tc.wantBody, rec.Body.String()[:min(120, rec.Body.Len())])
			}
			if loc := rec.Header().Get("Location"); loc != tc.wantLoc {
				t.Fatalf("Location = %q, want %q", loc, tc.wantLoc)
			}
		})
	}

	// Serve a real hashed asset from dist.
	entries, _ := fs.Glob(WebAssets, "assets/*.js")
	if len(entries) == 0 {
		t.Fatal("no built JS assets in web/dist")
	}
	assetPath := "/" + entries[0]
	req := httptest.NewRequest(http.MethodGet, assetPath, nil)
	rec := httptest.NewRecorder()
	handler(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("asset %s: status %d", assetPath, rec.Code)
	}
	if strings.Contains(strings.ToLower(rec.Body.String()), "<!doctype html>") {
		t.Fatalf("asset request returned index.html")
	}
}

func mustWebDist(t *testing.T) fs.FS {
	t.Helper()
	root := os.DirFS("../../web")
	if _, err := fs.Stat(root, "dist/index.html"); err != nil {
		t.Skip("web/dist not built; run npm run build in web/")
	}
	return root
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
