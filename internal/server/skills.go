package server

import (
	"encoding/json"
	"io/fs"
	"net/http"
	"sort"
	"strings"

	"github.com/go-chi/chi/v5"
)

// SkillAssets holds the embedded skills/ directory. The root package sets it at init.
// Each skill is a directory containing SKILL.md.
var SkillAssets fs.FS

// skillEntryName is the skill served at /skill.md — the installable entry document.
const skillEntryName = "llmwiki"

type skillInfo struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Lang        string `json:"lang,omitempty"`
	URL         string `json:"url"`
	URLZh       string `json:"url_zh,omitempty"`
}

type skillIndexResponse struct {
	Entry  string      `json:"entry"`
	Skills []skillInfo `json:"skills"`
}

// parseFrontmatter returns top-level "key: value" pairs from a leading YAML block.
func parseFrontmatter(doc string) map[string]string {
	out := map[string]string{}
	lines := strings.Split(doc, "\n")
	if len(lines) == 0 || strings.TrimSpace(lines[0]) != "---" {
		return out
	}
	for _, line := range lines[1:] {
		if strings.TrimSpace(line) == "---" {
			break
		}
		if line == "" || line[0] == ' ' || line[0] == '\t' || line[0] == '#' {
			continue
		}
		key, value, ok := strings.Cut(line, ":")
		if !ok {
			continue
		}
		out[strings.TrimSpace(key)] = strings.Trim(strings.TrimSpace(value), `"'`)
	}
	return out
}

func readSkillDoc(name string) (string, bool) {
	return readSkillFile(name, "SKILL.md")
}

func readSkillFile(name, file string) (string, bool) {
	if SkillAssets == nil {
		return "", false
	}
	data, err := fs.ReadFile(SkillAssets, name+"/"+file)
	if err != nil {
		return "", false
	}
	return string(data), true
}

func writeMarkdown(w http.ResponseWriter, doc string) {
	w.Header().Set("Content-Type", "text/markdown; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	w.Write([]byte(doc))
}

func writeSkillError(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

// handleSkillEntry serves the installable entry skill at /skill.md.
func (s *Server) handleSkillEntry(w http.ResponseWriter, r *http.Request) {
	doc, ok := readSkillDoc(skillEntryName)
	if !ok {
		writeSkillError(w, http.StatusNotFound, "skills not embedded in this build")
		return
	}
	writeMarkdown(w, doc)
}

// handleSkillDoc serves one stage skill at /skills/{name}.md.
func (s *Server) handleSkillDoc(w http.ResponseWriter, r *http.Request) {
	name := strings.TrimSuffix(chi.URLParam(r, "name"), ".md")
	if !validSkillName(name) {
		writeSkillError(w, http.StatusBadRequest, "invalid skill name")
		return
	}
	doc, ok := readSkillFile(name, "SKILL.md")
	if !ok {
		writeSkillError(w, http.StatusNotFound, "skill not found: "+name)
		return
	}
	writeMarkdown(w, doc)
}

// handleSkillDocZh serves the Chinese mirror at /skills/{name}.zh.md when present.
func (s *Server) handleSkillDocZh(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	if !validSkillName(name) {
		writeSkillError(w, http.StatusBadRequest, "invalid skill name")
		return
	}
	doc, ok := readSkillFile(name, "SKILL.zh.md")
	if !ok {
		writeSkillError(w, http.StatusNotFound, "no zh translation for skill: "+name)
		return
	}
	writeMarkdown(w, doc)
}

func validSkillName(name string) bool {
	if name == "" || len(name) > 64 {
		return false
	}
	for _, c := range name {
		if c != '-' && (c < 'a' || c > 'z') && (c < '0' || c > '9') {
			return false
		}
	}
	return true
}

// handleSkillIndex lists every embedded skill with its description and URL.
func (s *Server) handleSkillIndex(w http.ResponseWriter, r *http.Request) {
	if SkillAssets == nil {
		writeSkillError(w, http.StatusNotFound, "skills not embedded in this build")
		return
	}
	entries, err := fs.ReadDir(SkillAssets, ".")
	if err != nil {
		writeSkillError(w, http.StatusNotFound, "skills not embedded in this build")
		return
	}
	skills := make([]skillInfo, 0, len(entries))
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		name := e.Name()
		doc, ok := readSkillDoc(name)
		if !ok {
			continue
		}
		fm := parseFrontmatter(doc)
		info := skillInfo{
			Name:        name,
			Description: fm["description"],
			Lang:        fm["lang"],
			URL:         "/skills/" + name + ".md",
		}
		if _, ok := readSkillFile(name, "SKILL.zh.md"); ok {
			info.URLZh = "/skills/" + name + ".zh.md"
		}
		skills = append(skills, info)
	}
	sort.Slice(skills, func(i, j int) bool { return skills[i].Name < skills[j].Name })
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(skillIndexResponse{Entry: "/skill.md", Skills: skills})
}
