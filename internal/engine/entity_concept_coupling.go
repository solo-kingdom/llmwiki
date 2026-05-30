package engine

import (
	"fmt"
	"path/filepath"
	"strings"
	"unicode/utf8"
)

const minEntityPrefixRunes = 3

// LintCodeEntityConceptCoupling reports concept titles that bind an entity name to an abstract concept.
const LintCodeEntityConceptCoupling = "entity_concept_coupling"

var abstractConceptKeywords = []string{
	"方法", "方法论", "模型", "文化", "框架", "策略", "机制", "理论", "范式", "实践", "流程", "体系",
	"method", "methodology", "model", "culture", "framework", "strategy", "mechanism", "theory", "paradigm", "practice", "process", "system",
}

type entityNameEntry struct {
	display string
	key     string
}

func lintEntityConceptCoupling(pages []wikiPage, pageContents map[string]string) []LintIssue {
	entityNames := collectEntityNameEntries(pages, pageContents)
	if len(entityNames) == 0 {
		return nil
	}

	var issues []LintIssue
	for _, page := range pages {
		if page.subdir != "concepts" || !page.inTypedSubdir || page.isSystem {
			continue
		}
		content := pageContents[page.relPath]
		fm := ParseFrontmatter(content)
		title := strings.TrimSpace(fm.Title)
		if title == "" {
			title = TitleFromFilename(filepath.Base(page.relPath))
		}
		stem := strings.TrimSuffix(filepath.Base(page.relPath), filepath.Ext(page.relPath))

		if entity, suffix, ok := matchEntityConceptCoupling(title, entityNames); ok {
			issues = append(issues, entityConceptCouplingIssue(page.relPath, entity, suffix, title))
			continue
		}
		if normalizeNameKey(title) != normalizeNameKey(stem) {
			if entity, suffix, ok := matchEntityConceptCoupling(stem, entityNames); ok {
				issues = append(issues, entityConceptCouplingIssue(page.relPath, entity, suffix, stem))
			}
		}
	}
	return issues
}

func collectEntityNameEntries(pages []wikiPage, pageContents map[string]string) []entityNameEntry {
	seen := make(map[string]struct{})
	var entries []entityNameEntry

	add := func(display string) {
		display = strings.TrimSpace(display)
		if display == "" {
			return
		}
		key := normalizeNameKey(display)
		if utf8.RuneCountInString(key) < minEntityPrefixRunes {
			return
		}
		if _, ok := seen[key]; ok {
			return
		}
		seen[key] = struct{}{}
		entries = append(entries, entityNameEntry{display: display, key: key})
	}

	for _, page := range pages {
		if page.subdir != "entities" || !page.inTypedSubdir || page.isSystem {
			continue
		}
		content := pageContents[page.relPath]
		fm := ParseFrontmatter(content)
		if fm.Title != "" {
			add(fm.Title)
		}
		stem := strings.TrimSuffix(filepath.Base(page.relPath), filepath.Ext(page.relPath))
		add(stem)
		add(TitleFromFilename(stem))
	}
	return entries
}

func matchEntityConceptCoupling(name string, entities []entityNameEntry) (entityDisplay, suffix string, ok bool) {
	key := normalizeNameKey(name)
	if key == "" {
		return "", "", false
	}
	for _, entity := range entities {
		if !strings.HasPrefix(key, entity.key) || len(key) <= len(entity.key) {
			continue
		}
		suffixKey := key[len(entity.key):]
		if !hasAbstractConceptKeyword(suffixKey) {
			continue
		}
		return entity.display, suffixKey, true
	}
	return "", "", false
}

func hasAbstractConceptKeyword(suffixKey string) bool {
	if suffixKey == "" {
		return false
	}
	lower := strings.ToLower(suffixKey)
	for _, kw := range abstractConceptKeywords {
		if strings.Contains(lower, normalizeNameKey(kw)) {
			return true
		}
	}
	return false
}

func normalizeNameKey(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return ""
	}
	var b strings.Builder
	for _, r := range strings.ToLower(s) {
		switch r {
		case ' ', '_', '-', '　':
			continue
		default:
			b.WriteRune(r)
		}
	}
	return b.String()
}

func entityConceptCouplingIssue(relPath, entityDisplay, suffixKey, title string) LintIssue {
	_ = suffixKey
	return LintIssue{
		Severity: LintSeverityWarning,
		Code:     LintCodeEntityConceptCoupling,
		Path:     relPath,
		Message: fmt.Sprintf(
			"概念标题疑似绑定实体 %q：标题 %q 建议拆为中性概念页，并通过 [[%s]] 链接案例",
			entityDisplay, title, entityDisplay,
		),
	}
}
