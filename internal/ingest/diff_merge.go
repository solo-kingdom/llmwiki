package ingest

import (
	"context"
	"fmt"
	"regexp"
	"sort"
	"strings"
	"unicode/utf8"

	"github.com/solo-kingdom/llmwiki/internal/llm"
)

// Section represents a section of a wiki page body, split by ## headings.
type Section struct {
	Heading string // heading text including ## prefix (empty for preamble)
	Content string // body content under this heading
}

// SectionDiff describes the relationship between old and new sections.
type SectionDiff struct {
	Type       string   // "unchanged", "modified", "new", "deleted"
	Old        *Section // nil for "new"
	New        *Section // nil for "deleted"
	Similarity float64  // 0.0-1.0
}

var h2Re = regexp.MustCompile(`^## `)

// SplitSections splits body text into sections by ## headings.
// Preamble content before the first ## heading becomes a section with empty heading.
// ### and lower-level headings are treated as content within their parent ## section.
func SplitSections(body string) []Section {
	if strings.TrimSpace(body) == "" {
		return nil
	}

	lines := strings.Split(body, "\n")
	var sections []Section

	var currentHeading string
	var currentLines []string

	flush := func() {
		if len(currentLines) == 0 && currentHeading == "" {
			return
		}
		sections = append(sections, Section{
			Heading: currentHeading,
			Content: strings.TrimRight(strings.Join(currentLines, "\n"), "\n"),
		})
	}

	for _, line := range lines {
		if h2Re.MatchString(line) {
			flush()
			currentHeading = line
			currentLines = nil
		} else {
			currentLines = append(currentLines, line)
		}
	}
	flush()

	return sections
}

// DiffSections matches old and new sections and classifies diffs.
func DiffSections(oldSections, newSections []Section) []SectionDiff {
	usedOld := make(map[int]bool)
	usedNew := make(map[int]bool)
	var diffs []SectionDiff

	// Pass 1: exact heading match
	for iNew, ns := range newSections {
		for iOld, os := range oldSections {
			if usedOld[iOld] {
				continue
			}
			if headingMatch(os.Heading, ns.Heading) {
				usedOld[iOld] = true
				usedNew[iNew] = true
				if os.Content == ns.Content {
					diffs = append(diffs, SectionDiff{Type: "unchanged", Old: &oldSections[iOld], New: &newSections[iNew], Similarity: 1.0})
				} else {
					diffs = append(diffs, SectionDiff{Type: "modified", Old: &oldSections[iOld], New: &newSections[iNew], Similarity: sectionSimilarity(os.Content, ns.Content)})
				}
				break
			}
		}
	}

	// Pass 2: fuzzy heading match for unmatched new sections
	for iNew, ns := range newSections {
		if usedNew[iNew] {
			continue
		}
		bestOld := -1
		bestSim := 0.0
		for iOld, os := range oldSections {
			if usedOld[iOld] {
				continue
			}
			if os.Heading == "" || ns.Heading == "" {
				continue // skip preamble for fuzzy heading match
			}
			sim := headingSimilarity(os.Heading, ns.Heading)
			if sim > bestSim && sim >= 0.6 {
				bestSim = sim
				bestOld = iOld
			}
		}
		if bestOld >= 0 {
			usedOld[bestOld] = true
			usedNew[iNew] = true
			os := oldSections[bestOld]
			if os.Content == ns.Content {
				diffs = append(diffs, SectionDiff{Type: "unchanged", Old: &os, New: &ns, Similarity: 1.0})
			} else {
				diffs = append(diffs, SectionDiff{Type: "modified", Old: &os, New: &ns, Similarity: sectionSimilarity(os.Content, ns.Content)})
			}
		}
	}

	// Pass 3: content similarity match for unmatched preamble sections
	for iNew, ns := range newSections {
		if usedNew[iNew] || ns.Heading != "" {
			continue
		}
		for iOld, os := range oldSections {
			if usedOld[iOld] || os.Heading != "" {
				continue
			}
			sim := sectionSimilarity(os.Content, ns.Content)
			if sim >= 0.4 {
				usedOld[iOld] = true
				usedNew[iNew] = true
				if os.Content == ns.Content {
					diffs = append(diffs, SectionDiff{Type: "unchanged", Old: &os, New: &ns, Similarity: sim})
				} else {
					diffs = append(diffs, SectionDiff{Type: "modified", Old: &os, New: &ns, Similarity: sim})
				}
				break
			}
		}
	}

	// Remaining unmatched new sections → new
	for iNew := range newSections {
		if !usedNew[iNew] {
			diffs = append(diffs, SectionDiff{Type: "new", Old: nil, New: &newSections[iNew]})
		}
	}

	// Remaining unmatched old sections → deleted (preserved)
	for iOld := range oldSections {
		if !usedOld[iOld] {
			diffs = append(diffs, SectionDiff{Type: "deleted", Old: &oldSections[iOld], New: nil})
		}
	}

	return diffs
}

// headingMatch checks if two headings should be considered the same section.
func headingMatch(a, b string) bool {
	a = strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(a), "## "))
	b = strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(b), "## "))
	return strings.EqualFold(a, b)
}

// headingSimilarity computes similarity between two heading strings.
func headingSimilarity(a, b string) float64 {
	a = strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(a), "## "))
	b = strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(b), "## "))
	if a == "" || b == "" {
		return 0
	}
	al := strings.ToLower(a)
	bl := strings.ToLower(b)
	if al == bl {
		return 1.0
	}
	// Contains check
	if strings.Contains(al, bl) || strings.Contains(bl, al) {
		return 0.8
	}
	// Edit distance check (simple: skip if difference too large)
	if len(al) > 0 && len(bl) > 0 && editDistance(al, bl) <= 3 {
		return 0.7
	}
	return 0
}

// editDistance computes Levenshtein edit distance between two strings.
func editDistance(a, b string) int {
	la, lb := len(a), len(b)
	if la == 0 {
		return lb
	}
	if lb == 0 {
		return la
	}
	prev := make([]int, lb+1)
	curr := make([]int, lb+1)
	for j := 0; j <= lb; j++ {
		prev[j] = j
	}
	for i := 1; i <= la; i++ {
		curr[0] = i
		for j := 1; j <= lb; j++ {
			cost := 1
			if a[i-1] == b[j-1] {
				cost = 0
			}
			curr[j] = min(prev[j]+1, min(curr[j-1]+1, prev[j-1]+cost))
		}
		prev, curr = curr, prev
	}
	return prev[lb]
}

// sectionSimilarity computes a text similarity score between 0 and 1.
func sectionSimilarity(a, b string) float64 {
	a = strings.TrimSpace(a)
	b = strings.TrimSpace(b)
	if a == "" && b == "" {
		return 1.0
	}
	if a == "" || b == "" {
		return 0
	}
	// Use prefix of up to 200 runes for efficiency
	aRunes := []rune(a)
	bRunes := []rune(b)
	if len(aRunes) > 200 {
		aRunes = aRunes[:200]
	}
	if len(bRunes) > 200 {
		bRunes = bRunes[:200]
	}
	aSub := string(aRunes)
	bSub := string(bRunes)

	aTri := trigrams(aSub)
	bTri := trigrams(bSub)
	if len(aTri) == 0 && len(bTri) == 0 {
		return 1.0
	}
	if len(aTri) == 0 || len(bTri) == 0 {
		return 0
	}

	intersection := 0
	for t := range aTri {
		if bTri[t] {
			intersection++
		}
	}
	union := len(aTri) + len(bTri) - intersection
	if union == 0 {
		return 0
	}
	return float64(intersection) / float64(union)
}

// trigrams returns a set of character trigrams from s.
func trigrams(s string) map[string]bool {
	runes := []rune(s)
	set := make(map[string]bool)
	for i := 0; i+2 < len(runes); i++ {
		set[string(runes[i:i+3])] = true
	}
	return set
}

// shouldUseDiffMerge reports whether diff-based merge is appropriate.
func shouldUseDiffMerge(oldBody, newBody string) bool {
	// Too short — not worth splitting
	if utf8.RuneCountInString(oldBody) < 200 || utf8.RuneCountInString(newBody) < 200 {
		return false
	}

	oldSections := SplitSections(oldBody)
	newSections := SplitSections(newBody)

	// No ## heading structure at all
	if len(oldSections) <= 1 && len(newSections) <= 1 {
		return false
	}

	// Check if too many sections are "modified" — equivalent to a rewrite
	diffs := DiffSections(oldSections, newSections)
	modified := 0
	total := 0
	for _, d := range diffs {
		if d.Type == "modified" {
			modified++
		}
		if d.Type != "unchanged" {
			total++
		}
	}
	matched := len(diffs) - total
	if matched == 0 && modified > 0 {
		return false // no section matched at all
	}
	if modified > 0 && float64(modified)/float64(modified+len(diffs)-total) > 0.8 {
		return false // >80% modified = rewrite
	}

	return true
}

// mergeModifiedSection does a precise LLM merge for a single section.
func mergeModifiedSection(ctx context.Context, mc *MergeContext, oldSec, newSec *Section) (string, error) {
	if mc == nil || mc.LLMClient == nil {
		return newSec.Content, nil // fallback: use new content
	}

	headingLabel := "前言"
	if oldSec.Heading != "" {
		headingLabel = strings.TrimPrefix(oldSec.Heading, "## ")
	}

	systemMsg := ComposeSystemPrompt(StepMergeBody, PromptContext{DocLang: mc.DocLang})
	userMsg := fmt.Sprintf(
		"以下是 wiki 页面中「%s」章节的旧正文和新正文。\n"+
			"请合并：保留旧内容所有重要信息，仅补充新内容中的增量。\n"+
			"仅输出合并后的章节正文（不含标题行）。\n\n"+
			"## 旧正文\n\n%s\n\n## 新正文\n\n%s",
		headingLabel, oldSec.Content, newSec.Content,
	)
	messages := []llm.Message{
		{Role: "system", Content: systemMsg},
		{Role: "user", Content: userMsg},
	}

	const temp = 0.1
	const maxTok = 4096
	RecordLLMRequest(mc.Recorder, "diff_merge_section", mc.LLMClient.Model(), llmMessagesForRecord(messages), temp, maxTok)

	ch, err := mc.LLMClient.StreamChat(ctx, messages, temp, maxTok)
	if err != nil {
		return "", err
	}

	var merged strings.Builder
	for event := range ch {
		switch event.Type {
		case "token":
			merged.WriteString(event.Content)
		case "error":
			return "", event.Error
		}
	}
	result := strings.TrimSpace(merged.String())
	RecordLLMResponse(mc.Recorder, "diff_merge_section", result, 0)
	return result, nil
}

// DiffMergeBody performs section-level diff merge of old and new wiki body text.
// Falls back to full mergeBodyLLM when diff merge is not appropriate.
func DiffMergeBody(ctx context.Context, mc *MergeContext, oldBody, newBody string) (string, error) {
	if !shouldUseDiffMerge(oldBody, newBody) {
		return mergeBodyLLM(ctx, mc, oldBody, newBody)
	}

	oldSections := SplitSections(oldBody)
	newSections := SplitSections(newBody)
	diffs := DiffSections(oldSections, newSections)

	// Sort diffs to preserve original ordering: old sections first, then new sections
	sort.SliceStable(diffs, func(i, j int) bool {
		// Maintain relative order: deleted/unchanged/modified by old index, new by new index
		getOldIdx := func(d SectionDiff) int {
			if d.Old != nil {
				for k, s := range oldSections {
					if s == *d.Old {
						return k
					}
				}
			}
			return len(oldSections) // new sections go last
		}
		return getOldIdx(diffs[i]) < getOldIdx(diffs[j])
	})

	var parts []string
	for _, d := range diffs {
		switch d.Type {
		case "unchanged":
			parts = append(parts, formatSection(d.Old))
		case "deleted":
			// Safety: preserve old content
			parts = append(parts, formatSection(d.Old))
		case "new":
			parts = append(parts, formatSection(d.New))
		case "modified":
			merged, err := mergeModifiedSection(ctx, mc, d.Old, d.New)
			if err != nil {
				// Fallback: use old content + append new on error
				parts = append(parts, formatSection(d.Old))
				continue
			}
			heading := d.Old.Heading
			if heading != "" {
				parts = append(parts, heading+"\n"+merged)
			} else {
				parts = append(parts, merged)
			}
		}
	}

	result := strings.Join(parts, "\n\n")
	result = strings.TrimSpace(result)

	// Length guard
	oldLen := utf8.RuneCountInString(oldBody)
	if oldLen > 0 {
		resultLen := utf8.RuneCountInString(result)
		minLen := int(float64(oldLen) * mergeMinBodyRatio)
		if resultLen < minLen {
			return "", fmt.Errorf("diff merge too aggressive: merged %d chars < 70%% of old %d chars", resultLen, oldLen)
		}
	}

	return result, nil
}

// formatSection renders a section as markdown.
func formatSection(s *Section) string {
	if s.Heading == "" {
		return s.Content
	}
	if strings.TrimSpace(s.Content) == "" {
		return s.Heading
	}
	return s.Heading + "\n" + s.Content
}
