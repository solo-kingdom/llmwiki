package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/solo-kingdom/llmwiki/internal/store/sqlite"
)

func workspaceTestRouter(api *API) *chi.Mux {
	r := chi.NewRouter()
	r.Get("/api/v1/workspace", api.GetWorkspace)
	r.Post("/api/v1/documents", api.CreateDocument)
	return r
}

func TestGetWorkspaceOverview(t *testing.T) {
	api, _ := setupTestAPI(t)
	root := api.workspace

	for _, f := range []string{"purpose.md", "rules.md", "raw/sources/a.md"} {
		full := filepath.Join(root, f)
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(full, []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	for _, f := range []string{"wiki/entities/alpha.md", "wiki/concepts/beta.md", "wiki/entities/gamma.md", "wiki/overview.md"} {
		full := filepath.Join(root, f)
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(full, []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	if err := api.db.CreateDocument(&sqlite.Document{
		Filename: "alpha.md", Path: "/wiki/entities/", RelativePath: "wiki/entities/alpha.md",
		SourceKind: "wiki", Status: "ready", Content: "x",
	}); err != nil {
		t.Fatal(err)
	}
	if err := api.db.CreateDocument(&sqlite.Document{
		Filename: "a.md", Path: "/raw/sources/", RelativePath: "raw/sources/a.md",
		SourceKind: "source", Status: "ready", Content: "x",
	}); err != nil {
		t.Fatal(err)
	}

	rec := httptest.NewRecorder()
	workspaceTestRouter(api).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/workspace", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body %s", rec.Code, rec.Body.String())
	}

	var got workspaceOverview
	if err := json.NewDecoder(rec.Body).Decode(&got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if !got.Layout.Purpose || !got.Layout.Rules || !got.Layout.Wiki || !got.Layout.RawSources {
		t.Errorf("layout flags not detected: %+v", got.Layout)
	}
	if got.Layout.IndexDB {
		t.Errorf("index_db should be false in a bare workspace")
	}
	if got.Counts.Documents != 2 || got.Counts.WikiPages != 1 || got.Counts.Sources != 1 {
		t.Errorf("counts = %+v", got.Counts)
	}
	if got.PageTypes["entity"] != 1 {
		t.Errorf("page_types = %+v, want entity=1", got.PageTypes)
	}

	dirs := map[string]int{}
	for _, d := range got.WikiDirs {
		dirs[d.Dir] = d.Count
	}
	if dirs["entities"] != 2 || dirs["concepts"] != 1 || dirs[""] != 1 {
		t.Errorf("wiki_dirs = %+v", got.WikiDirs)
	}
}

func TestGetWorkspaceWithoutWorkspace(t *testing.T) {
	api, _ := setupTestAPI(t)
	api.workspace = ""

	rec := httptest.NewRecorder()
	workspaceTestRouter(api).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/workspace", nil))
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", rec.Code)
	}
}

func TestCreateDocumentDerivesWikiKindFromPath(t *testing.T) {
	api, _ := setupTestAPI(t)
	r := workspaceTestRouter(api)

	for i, tc := range []struct {
		path    string
		want    string
		wantRel string
		wantDir string
	}{
		{"/wiki/entities", "wiki", "wiki/entities/page-0.md", "/wiki/entities/"},
		{"wiki/entities", "wiki", "wiki/entities/page-1.md", "/wiki/entities/"},
		{"/raw/sources", "source", "raw/sources/page-2.md", "/raw/sources/"},
		{"", "source", "page-3.md", "/"},
	} {
		filename := fmt.Sprintf("page-%d.md", i)
		body, _ := json.Marshal(map[string]interface{}{
			"filename": filename,
			"path":     tc.path,
			"content":  "x",
		})
		req := httptest.NewRequest(http.MethodPost, "/api/v1/documents", bytes.NewReader(body))
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, req)
		if rec.Code != http.StatusCreated {
			t.Fatalf("path %q: status = %d, body %s", tc.path, rec.Code, rec.Body.String())
		}
		var doc sqlite.Document
		if err := json.NewDecoder(rec.Body).Decode(&doc); err != nil {
			t.Fatal(err)
		}
		if doc.SourceKind != tc.want {
			t.Errorf("path %q: source_kind = %q, want %q", tc.path, doc.SourceKind, tc.want)
		}
		if doc.RelativePath != tc.wantRel {
			t.Errorf("path %q: relative_path = %q, want %q", tc.path, doc.RelativePath, tc.wantRel)
		}
		if doc.Path != tc.wantDir {
			t.Errorf("path %q: path = %q, want %q", tc.path, doc.Path, tc.wantDir)
		}
	}
}
