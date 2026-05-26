package ingest

import (
	"fmt"
	"sort"
	"strings"

	"github.com/solo-kingdom/llmwiki/internal/engine"
	"github.com/solo-kingdom/llmwiki/internal/store/sqlite"
)

const (
	maxRelatedSubsetEntries = 8
	maxGraphExpandNodes     = 20
	maxFTSSeeds             = 5
)

// WikiRefInput is a wiki page referenced by the user in chat.
type WikiRefInput struct {
	DocumentID   string
	RelativePath string
	Title        string
}

// RelatedSubsetEntry is one row in the related wiki subset index.
type RelatedSubsetEntry struct {
	RelativePath string
	Title        string
	Score        float64
}

// ContextResolver computes a ranked wiki subset for session chat.
type ContextResolver struct {
	DB        *sqlite.DB
	Workspace string
}

// ResolveRelatedSubset returns up to maxRelatedSubsetEntries wiki paths relevant to the turn.
func (r *ContextResolver) ResolveRelatedSubset(userQuery string, refs []WikiRefInput) ([]RelatedSubsetEntry, error) {
	if r == nil || r.DB == nil {
		return nil, nil
	}

	deadTargets, err := r.deadLinkTargets()
	if err != nil {
		return nil, err
	}

	scores := make(map[string]float64)
	titles := make(map[string]string)

	add := func(path, title string, score float64) {
		path = strings.TrimSpace(path)
		if path == "" || deadTargets[path] {
			return
		}
		if title == "" {
			title = path
		}
		titles[path] = title
		if score > scores[path] {
			scores[path] = score
		}
	}

	for _, ref := range refs {
		path := strings.TrimSpace(ref.RelativePath)
		title := strings.TrimSpace(ref.Title)
		if path == "" && ref.DocumentID != "" {
			if doc, err := r.DB.GetWikiDocumentByID(ref.DocumentID); err == nil && doc != nil {
				path = doc.RelativePath
				if title == "" {
					title = doc.Title
				}
			}
		}
		add(path, title, 1.0)
	}

	query := strings.TrimSpace(userQuery)
	if query != "" {
		hits, err := r.DB.SearchChunks(query, maxFTSSeeds, "wiki")
		if err != nil {
			return nil, err
		}
		for i, hit := range hits {
			score := 0.8 - float64(i)*0.05
			add(hit.Path, hit.Title, score)
		}
	}

	seedPaths := make([]string, 0, len(scores))
	for path := range scores {
		if scores[path] >= 0.7 {
			seedPaths = append(seedPaths, path)
		}
	}

	if len(seedPaths) > 0 {
		adj, err := r.buildAdjacency()
		if err != nil {
			return nil, err
		}
		visited := make(map[string]int)
		queue := make([]struct {
			path  string
			depth int
		}, 0, len(seedPaths))
		for _, p := range seedPaths {
			visited[p] = 0
			queue = append(queue, struct {
				path  string
				depth int
			}{p, 0})
		}
		expanded := 0
		for len(queue) > 0 && expanded < maxGraphExpandNodes {
			cur := queue[0]
			queue = queue[1:]
			if cur.depth >= 2 {
				continue
			}
			for _, nb := range adj[cur.path] {
				if deadTargets[nb] {
					continue
				}
				if _, ok := visited[nb]; ok {
					continue
				}
				visited[nb] = cur.depth + 1
				expanded++
				score := 0.7
				if cur.depth+1 == 2 {
					score = 0.4
				}
				add(nb, nb, score)
				queue = append(queue, struct {
					path  string
					depth int
				}{nb, cur.depth + 1})
			}
		}
	}

	if len(scores) == 0 {
		return nil, nil
	}

	out := make([]RelatedSubsetEntry, 0, len(scores))
	for path, score := range scores {
		out = append(out, RelatedSubsetEntry{
			RelativePath: path,
			Title:        titles[path],
			Score:        score,
		})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Score == out[j].Score {
			return out[i].RelativePath < out[j].RelativePath
		}
		return out[i].Score > out[j].Score
	})
	if len(out) > maxRelatedSubsetEntries {
		out = out[:maxRelatedSubsetEntries]
	}
	return out, nil
}

func (r *ContextResolver) buildAdjacency() (map[string][]string, error) {
	edges, err := r.DB.ListWikiGraphEdges()
	if err != nil {
		return nil, err
	}
	adj := make(map[string][]string)
	for _, e := range edges {
		adj[e.Source] = append(adj[e.Source], e.Target)
		adj[e.Target] = append(adj[e.Target], e.Source)
	}
	return adj, nil
}

func (r *ContextResolver) deadLinkTargets() (map[string]bool, error) {
	out := make(map[string]bool)
	if strings.TrimSpace(r.Workspace) == "" {
		return out, nil
	}
	report, err := engine.LintWorkspace(r.Workspace)
	if err != nil {
		return out, err
	}
	for _, issue := range report.Issues {
		if issue.Code != engine.LintCodeDeadLink {
			continue
		}
		out[issue.Path] = true
	}
	return out, nil
}

// FormatRelatedSubsetSection renders the system prompt subsection for related wiki pages.
func FormatRelatedSubsetSection(docLang string, entries []RelatedSubsetEntry) string {
	if len(entries) == 0 {
		return ""
	}
	var b strings.Builder
	if docLang == "en" {
		b.WriteString("## Related wiki subset (index only — use read tool for full text)\n\n")
	} else {
		b.WriteString("## 相关 wiki 子集（仅索引，全文请用 read 工具）\n\n")
	}
	for _, e := range entries {
		title := e.Title
		if title == "" {
			title = e.RelativePath
		}
		b.WriteString(fmt.Sprintf("- `%s` — %s\n", e.RelativePath, title))
	}
	return b.String()
}

// InjectWikiRefsIntoUserContent prepends full wiki page bodies before the user message.
func InjectWikiRefsIntoUserContent(docLang string, refs []WikiRefInput, bodies []WikiPageBody, userText string) string {
	var b strings.Builder
	for i, body := range bodies {
		ref := refs[i]
		label := ref.RelativePath
		if label == "" {
			label = ref.DocumentID
		}
		if docLang == "en" {
			b.WriteString(fmt.Sprintf("[Wiki reference: %s]\n", label))
		} else {
			b.WriteString(fmt.Sprintf("[Wiki 引用: %s]\n", label))
		}
		if body.Title != "" {
			b.WriteString(body.Title + "\n\n")
		}
		b.WriteString(body.Content)
		b.WriteString("\n\n---\n\n")
	}
	b.WriteString(userText)
	return b.String()
}

// WikiPageBody is full text loaded for a wiki ref.
type WikiPageBody struct {
	DocumentID   string
	RelativePath string
	Title        string
	Content      string
}

const maxWikiRefInjectLen = 120000

// LoadWikiPageBodies reads full wiki content for refs.
func LoadWikiPageBodies(db *sqlite.DB, refs []WikiRefInput) ([]WikiPageBody, error) {
	out := make([]WikiPageBody, 0, len(refs))
	for _, ref := range refs {
		doc, err := db.GetWikiDocumentByID(ref.DocumentID)
		if err != nil {
			return nil, err
		}
		if doc == nil {
			return nil, fmt.Errorf("wiki document not found: %s", ref.DocumentID)
		}
		content := doc.Content
		if len(content) > maxWikiRefInjectLen {
			content = content[:maxWikiRefInjectLen] + "\n...(truncated)"
		}
		out = append(out, WikiPageBody{
			DocumentID:   doc.ID,
			RelativePath: doc.RelativePath,
			Title:        doc.Title,
			Content:      content,
		})
	}
	return out, nil
}
