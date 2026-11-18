package api

import (
	"context"
	"sort"
	"strings"
	"time"

	"github.com/solo-kingdom/llmwiki/internal/llm"
	"github.com/solo-kingdom/llmwiki/internal/store"
)

// hybridSearch combines keyword and vector results with reciprocal rank fusion.
// It silently falls back to keyword results when embeddings are unavailable.
func (a *API) hybridSearch(query string, limit int, pathFilter string, pageTypes []string, mode string) ([]store.SearchChunk, error) {
	keyword, err := a.db.SearchChunks(query, limit, pathFilter, pageTypes...)
	if err != nil {
		return nil, err
	}
	if mode == "keyword" {
		return keyword, nil
	}
	client, settings, cfgErr := llm.EmbeddingClient(a.db)
	if cfgErr != nil || client == nil || settings.Model == "" {
		return keyword, nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	vectors, embedErr := client.Embeddings(ctx, settings.Model, []string{query})
	if embedErr != nil || len(vectors) == 0 {
		return keyword, nil
	}
	semantic, err := a.db.SearchVector(vectors[0], settings.Model, limit, pathFilter, pageTypes...)
	if err != nil {
		return keyword, nil
	}
	if mode == "semantic" {
		return markMatchType(semantic, "semantic"), nil
	}
	return fuseSearch(keyword, semantic, limit), nil
}

func markMatchType(results []store.SearchChunk, kind string) []store.SearchChunk {
	for i := range results {
		results[i].MatchType = kind
	}
	return results
}

// fuseSearch applies reciprocal rank fusion and dedupes by document ID.
func fuseSearch(keyword, semantic []store.SearchChunk, limit int) []store.SearchChunk {
	const k = 60.0
	type entry struct {
		result store.SearchChunk
		score  float64
		order  int
	}
	merged := map[string]*entry{}
	add := func(results []store.SearchChunk, kind string) {
		for rank, r := range results {
			r.MatchType = kind
			e, ok := merged[r.DocumentID]
			if !ok {
				e = &entry{result: r, order: len(merged)}
				merged[r.DocumentID] = e
			}
			e.score += 1.0 / (k + float64(rank+1))
		}
	}
	add(keyword, "keyword")
	add(semantic, "semantic")
	entries := make([]*entry, 0, len(merged))
	for _, e := range merged {
		entries = append(entries, e)
	}
	sort.SliceStable(entries, func(i, j int) bool {
		if entries[i].score == entries[j].score {
			return entries[i].order < entries[j].order
		}
		return entries[i].score > entries[j].score
	})
	out := make([]store.SearchChunk, 0, limit)
	for _, e := range entries {
		e.result.Score = e.score
		out = append(out, e.result)
		if len(out) >= limit {
			break
		}
	}
	return out
}

// normalizeSearchMode validates the requested search mode.
func normalizeSearchMode(raw string) string {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "keyword", "semantic", "hybrid":
		return strings.ToLower(strings.TrimSpace(raw))
	default:
		return "auto"
	}
}
