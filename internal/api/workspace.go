package api

import (
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/solo-kingdom/llmwiki/internal/engine"
)

// workspaceLayout reports which workspace scaffold entries exist on disk.
type workspaceLayout struct {
	Purpose    bool `json:"purpose"`
	Rules      bool `json:"rules"`
	Wiki       bool `json:"wiki"`
	RawSources bool `json:"raw_sources"`
	IndexDB    bool `json:"index_db"`
}

// workspaceCounts summarizes indexed documents by kind.
type workspaceCounts struct {
	Documents int `json:"documents"`
	WikiPages int `json:"wiki_pages"`
	Sources   int `json:"sources"`
}

// workspaceDir counts markdown files per top-level wiki/ directory.
type workspaceDir struct {
	Dir   string `json:"dir"`
	Count int    `json:"count"`
}

// workspaceOverview is the agent-facing answer to "what is in this workspace".
type workspaceOverview struct {
	Root        string          `json:"root"`
	Layout      workspaceLayout `json:"layout"`
	Counts      workspaceCounts `json:"counts"`
	PageTypes   map[string]int  `json:"page_types"`
	WikiDirs    []workspaceDir  `json:"wiki_dirs"`
	LastUpdated string          `json:"last_updated,omitempty"`
}

func fileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}

func dirExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.IsDir()
}

// countMarkdownByDir returns markdown counts for direct subdirectories of dir,
// plus an entry for files directly inside dir (Dir "").
func countMarkdownByDir(dir string) []workspaceDir {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil
	}
	counts := map[string]int{}
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		if isMarkdownFile(e.Name()) {
			counts[""]++
		}
	}
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		if _, ok := engine.WikiSystemSubdirs[e.Name()]; ok {
			continue
		}
		sub := filepath.Join(dir, e.Name())
		n := 0
		entries, err := os.ReadDir(sub)
		if err != nil {
			continue
		}
		for _, f := range entries {
			if !f.IsDir() && isMarkdownFile(f.Name()) {
				n++
			}
		}
		counts[e.Name()] = n
	}
	out := make([]workspaceDir, 0, len(counts))
	for name, n := range counts {
		out = append(out, workspaceDir{Dir: name, Count: n})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Dir == "" {
			return true
		}
		if out[j].Dir == "" {
			return false
		}
		return out[i].Dir < out[j].Dir
	})
	return out
}

// businessPageTypes seeds page_types with every business type so an agent can tell
// "no such pages" from "this type is empty". Templates and top-level pages are excluded.
func businessPageTypes() map[string]int {
	out := make(map[string]int, len(engine.PageTypeToWikiSubdir))
	for t := range engine.PageTypeToWikiSubdir {
		out[t] = 0
	}
	return out
}

func isMarkdownFile(name string) bool {
	return strings.EqualFold(filepath.Ext(name), ".md")
}

// GetWorkspace returns a workspace overview: layout flags, document counts,
// page-type distribution, and per-directory markdown counts.
func (a *API) GetWorkspace(w http.ResponseWriter, r *http.Request) {
	if a.workspace == "" {
		writeError(w, http.StatusServiceUnavailable, "workspace not configured")
		return
	}
	root := a.workspace
	overview := workspaceOverview{
		Root: root,
		Layout: workspaceLayout{
			Purpose:    fileExists(filepath.Join(root, "purpose.md")),
			Rules:      fileExists(filepath.Join(root, "rules.md")),
			Wiki:       dirExists(filepath.Join(root, "wiki")),
			RawSources: dirExists(filepath.Join(root, "raw", "sources")),
			IndexDB:    fileExists(filepath.Join(root, ".llmwiki", "index.db")),
		},
		PageTypes: businessPageTypes(),
		WikiDirs:  countMarkdownByDir(filepath.Join(root, "wiki")),
	}

	if a.db != nil {
		docs, err := a.db.ListDocuments()
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		for _, d := range docs {
			overview.Counts.Documents++
			switch d.SourceKind {
			case "wiki":
				overview.Counts.WikiPages++
				if t := engine.WikiPageType(d.RelativePath); engine.PageTypeToWikiSubdir[t] != "" {
					overview.PageTypes[t]++
				}
			case "source":
				overview.Counts.Sources++
			}
			if d.UpdatedAt > overview.LastUpdated {
				overview.LastUpdated = d.UpdatedAt
			}
		}
	}
	if overview.WikiDirs == nil {
		overview.WikiDirs = []workspaceDir{}
	}
	writeJSON(w, http.StatusOK, overview)
}
