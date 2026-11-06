package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/go-chi/chi/v5"
)

func withSkillAssets(t *testing.T) {
	t.Helper()
	prev := SkillAssets
	SkillAssets = fstest.MapFS{
		"llmwiki/SKILL.md":          &fstest.MapFile{Data: []byte("---\nname: llmwiki\ndescription: entry skill\n---\n\n# entry\n")},
		"llmwiki-query/SKILL.md":    &fstest.MapFile{Data: []byte("---\nname: llmwiki-query\ndescription: query skill\n---\n\n# query\n")},
		"llmwiki-query/SKILL.zh.md": &fstest.MapFile{Data: []byte("---\nname: llmwiki-query\ndescription: 查询技能\n---\n\n# 查询\n")},
		"notes.txt":                 &fstest.MapFile{Data: []byte("ignored")},
	}
	t.Cleanup(func() { SkillAssets = prev })
}

func skillTestRouter(s *Server) *chi.Mux {
	r := chi.NewRouter()
	r.Get("/api/v1/skills", s.handleSkillIndex)
	r.Get("/skill.md", s.handleSkillEntry)
	r.Get("/skills/{name}.md", s.handleSkillDoc)
	r.Get("/skills/{name}.zh.md", s.handleSkillDocZh)
	return r
}

func TestSkillEntry(t *testing.T) {
	withSkillAssets(t)
	r := skillTestRouter(&Server{})

	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/skill.md", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "text/markdown") {
		t.Errorf("content-type = %q", ct)
	}
	if !strings.Contains(rec.Body.String(), "# entry") {
		t.Errorf("body = %q", rec.Body.String())
	}
}

func TestSkillDocAndUnknown(t *testing.T) {
	withSkillAssets(t)
	r := skillTestRouter(&Server{})

	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/skills/llmwiki-query.md", nil))
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "# query") {
		t.Fatalf("status = %d, body %q", rec.Code, rec.Body.String())
	}

	rec = httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/skills/llmwiki-missing.md", nil))
	if rec.Code != http.StatusNotFound {
		t.Errorf("status = %d, want 404", rec.Code)
	}

	rec = httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/skills/Bad_Name.md", nil))
	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", rec.Code)
	}
}

func TestSkillDocChineseMirror(t *testing.T) {
	withSkillAssets(t)
	r := skillTestRouter(&Server{})

	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/skills/llmwiki-query.zh.md", nil))
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "# 查询") {
		t.Fatalf("status = %d, body %q", rec.Code, rec.Body.String())
	}

	// a skill without a translation still reports a clean 404
	rec = httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/skills/llmwiki.zh.md", nil))
	if rec.Code != http.StatusNotFound {
		t.Errorf("status = %d, want 404", rec.Code)
	}
}

func TestSkillIndexListsSkillDirs(t *testing.T) {
	withSkillAssets(t)
	r := skillTestRouter(&Server{})

	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/skills", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	var got skillIndexResponse
	if err := json.NewDecoder(rec.Body).Decode(&got); err != nil {
		t.Fatal(err)
	}
	if got.Entry != "/skill.md" {
		t.Errorf("entry = %q", got.Entry)
	}
	if len(got.Skills) != 2 {
		t.Fatalf("skills = %+v", got.Skills)
	}
	if got.Skills[0].Name != "llmwiki" || got.Skills[0].URL != "/skills/llmwiki.md" {
		t.Errorf("first = %+v", got.Skills[0])
	}
	if got.Skills[1].Description != "query skill" {
		t.Errorf("description = %q", got.Skills[1].Description)
	}
	if got.Skills[1].URLZh != "/skills/llmwiki-query.zh.md" {
		t.Errorf("url_zh = %q", got.Skills[1].URLZh)
	}
	if got.Skills[0].URLZh != "" {
		t.Errorf("entry skill should have no translation, got %q", got.Skills[0].URLZh)
	}
}

func TestSkillIndexWithoutEmbeddedSkills(t *testing.T) {
	prev := SkillAssets
	SkillAssets = nil
	t.Cleanup(func() { SkillAssets = prev })

	r := skillTestRouter(&Server{})
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/skills", nil))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}
