package ingest

import (
	"strings"
	"testing"
)

func TestPostApplyDeleteInjectionMove(t *testing.T) {
	planJSON := `{"summary":"move test","changes":[{"action":"move","from_path":"wiki/concepts/Old.md","to_path":"wiki/concepts/New.md","path":"wiki/concepts/New.md","rationale":"rename"}]}`

	llmOutput := `---FILE: wiki/concepts/New.md
# New Page
Content here.
---END FILE---`

	blocks := parseFileBlocksWithContent(llmOutput)
	blocks, _, _ = normalizeWikiFileBlocks(blocks)

	actions := ParsePlanActions(planJSON)
	deletePaths := SourcePathsToDelete(actions, blocks)

	for _, dp := range deletePaths {
		blocks[dp] = "---DELETE---\n"
	}

	if _, ok := blocks["wiki/concepts/Old.md"]; !ok {
		t.Fatal("expected DELETE block for wiki/concepts/Old.md")
	}
	if blocks["wiki/concepts/Old.md"] != "---DELETE---\n" {
		t.Fatalf("expected DELETE marker, got %q", blocks["wiki/concepts/Old.md"])
	}
	if _, ok := blocks["wiki/concepts/New.md"]; !ok {
		t.Fatal("expected write block for wiki/concepts/New.md")
	}
}

func TestPostApplyDeleteInjectionMerge(t *testing.T) {
	planJSON := `{"summary":"merge test","changes":[{"action":"merge","source_paths":["wiki/concepts/A.md","wiki/concepts/B.md"],"to_path":"wiki/concepts/C.md","path":"wiki/concepts/C.md","rationale":"deduplicate"}]}`

	llmOutput := `---FILE: wiki/concepts/C.md
# Merged
Combined content.
---END FILE---`

	blocks := parseFileBlocksWithContent(llmOutput)
	blocks, _, _ = normalizeWikiFileBlocks(blocks)

	actions := ParsePlanActions(planJSON)
	deletePaths := SourcePathsToDelete(actions, blocks)

	for _, dp := range deletePaths {
		blocks[dp] = "---DELETE---\n"
	}

	for _, path := range []string{"wiki/concepts/A.md", "wiki/concepts/B.md"} {
		if blocks[path] != "---DELETE---\n" {
			t.Fatalf("expected DELETE block for %s, got %q", path, blocks[path])
		}
	}
}

func TestPostApplyDeleteSkipsWriteTargetOverlap(t *testing.T) {
	planJSON := `{"summary":"move overlap","changes":[{"action":"move","from_path":"wiki/concepts/A.md","to_path":"wiki/concepts/B.md","path":"wiki/concepts/B.md","rationale":"rename"}]}`

	llmOutput := `---FILE: wiki/concepts/A.md
# A Updated
New content for A.
---END FILE---
---FILE: wiki/concepts/B.md
# B
Moved content.
---END FILE---`

	blocks := parseFileBlocksWithContent(llmOutput)
	blocks, _, _ = normalizeWikiFileBlocks(blocks)

	actions := ParsePlanActions(planJSON)
	deletePaths := SourcePathsToDelete(actions, blocks)

	if len(deletePaths) != 0 {
		t.Fatalf("expected no deletions (from_path is a write target), got %v", deletePaths)
	}
}

func TestPostApplyDeleteSkipsInvalidPaths(t *testing.T) {
	planJSON := `{"summary":"invalid","changes":[{"action":"move","from_path":"raw/invalid.md","to_path":"wiki/concepts/New.md","path":"wiki/concepts/New.md","rationale":"invalid source"}]}`

	llmOutput := `---FILE: wiki/concepts/New.md
# New
Content.
---END FILE---`

	blocks := parseFileBlocksWithContent(llmOutput)
	blocks, _, _ = normalizeWikiFileBlocks(blocks)

	actions := ParsePlanActions(planJSON)
	deletePaths := SourcePathsToDelete(actions, blocks)

	if len(deletePaths) != 0 {
		t.Fatalf("expected no deletions (invalid source path), got %v", deletePaths)
	}
}

func TestPostApplyDeleteMergeSkipsToPath(t *testing.T) {
	planJSON := `{"summary":"merge with self","changes":[{"action":"merge","source_paths":["wiki/concepts/A.md","wiki/concepts/B.md"],"to_path":"wiki/concepts/A.md","path":"wiki/concepts/A.md","rationale":"merge into A"}]}`

	llmOutput := `---FILE: wiki/concepts/A.md
# A Merged
Combined.
---END FILE---`

	blocks := parseFileBlocksWithContent(llmOutput)
	blocks, _, _ = normalizeWikiFileBlocks(blocks)

	actions := ParsePlanActions(planJSON)
	deletePaths := SourcePathsToDelete(actions, blocks)

	if len(deletePaths) != 1 || deletePaths[0] != "wiki/concepts/B.md" {
		t.Fatalf("expected only B.md deleted (A.md is to_path), got %v", deletePaths)
	}

	for _, dp := range deletePaths {
		blocks[dp] = "---DELETE---\n"
	}

	if _, ok := blocks["wiki/concepts/A.md"]; !ok || strings.Contains(blocks["wiki/concepts/A.md"], "DELETE") {
		t.Fatal("A.md should be a write block, not DELETE")
	}
	if blocks["wiki/concepts/B.md"] != "---DELETE---\n" {
		t.Fatal("B.md should be a DELETE block")
	}
}
