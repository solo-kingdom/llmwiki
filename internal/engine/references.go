package engine

import (
	"fmt"
	"regexp"
	"strings"
)

// Reference represents a parsed citation or wiki link edge.
type Reference struct {
	TargetPath string // resolved path to the target document
	RefType    string // "cites" or "links_to"
	Page       *int   // page number for citations, nil for wiki links
}

// ReferenceParser extracts citations and wiki links from markdown content.
type ReferenceParser struct {
	// Index of documents for resolution
	docsByFilename  map[string]string // lowercase filename → doc ID
	docsByBase      map[string]string // lowercase basename (no ext) → doc ID
	docsByWikiPath  map[string]string // lowercase wiki-relative path → doc ID
}

// NewReferenceParser creates a parser with the given document index.
// docs should contain at minimum: filename, path, source_kind.
func NewReferenceParser(docs []DocIndexEntry) *ReferenceParser {
	rp := &ReferenceParser{
		docsByFilename: make(map[string]string),
		docsByBase:     make(map[string]string),
		docsByWikiPath: make(map[string]string),
	}
	for _, d := range docs {
		fnLower := strings.ToLower(d.Filename)
		rp.docsByFilename[fnLower] = d.ID
		if d.Title != "" {
			titleLower := strings.ToLower(d.Title)
			if _, exists := rp.docsByFilename[titleLower]; !exists {
				rp.docsByFilename[titleLower] = d.ID
			}
		}
		// Store base name (without extension)
		base := stripExtension(fnLower)
		rp.docsByBase[base] = d.ID

		// Store wiki paths
		if strings.HasPrefix(d.Path, "/wiki/") {
			relative := strings.TrimPrefix(d.Path+d.Filename, "/wiki/")
			rp.docsByWikiPath[strings.ToLower(relative)] = d.ID
		}
	}
	return rp
}

// DocIndexEntry is a minimal document entry for the reference parser.
type DocIndexEntry struct {
	ID       string
	Filename string
	Title    string
	Path     string
}

// ParseReferences extracts all citations and wiki links from content.
// docPath is the path of the source document (e.g., "/wiki/concepts/attention.md").
func (rp *ReferenceParser) ParseReferences(content, docPath string) []Reference {
	var refs []Reference

	// Parse citations: [^N]: file.pdf, p.3
	cites := rp.parseCitations(content)
	for _, c := range cites {
		refs = append(refs, c)
	}

	// Parse wiki links: [text](path.md)
	links := rp.parseWikiLinks(content, docPath)
	refs = append(refs, links...)

	return refs
}

// citationRe matches footnote citations.
var citationRe = regexp.MustCompile(`\[\^\d+\]:\s*(.+)$`)

func (rp *ReferenceParser) parseCitations(content string) []Reference {
	var refs []Reference
	matches := citationRe.FindAllStringSubmatch(content, -1)
	for _, match := range matches {
		if len(match) < 2 {
			continue
		}
		raw := strings.TrimSpace(match[1])
		raw = strings.Trim(raw, "*")

		filename, page := parseCitationFile(raw)
		if filename == "" {
			continue
		}

		targetID := rp.resolveFilename(filename)
		if targetID == "" {
			continue
		}

		refs = append(refs, Reference{
			TargetPath: targetID,
			RefType:    "cites",
			Page:       page,
		})
	}
	return refs
}

// wikiLinkRe matches markdown links: [text](href)
var wikiLinkRe = regexp.MustCompile(`(?<!!)\[(?:[^\]]*)\]\(([^)]+)\)`)

func (rp *ReferenceParser) parseWikiLinks(content, docPath string) []Reference {
	// Determine the wiki-relative directory of the source doc
	wikiRel := ""
	if strings.HasPrefix(docPath, "/wiki/") {
		wikiRel = strings.TrimPrefix(docPath, "/wiki/")
		// Strip filename
		if idx := strings.LastIndex(wikiRel, "/"); idx >= 0 {
			wikiRel = wikiRel[:idx+1]
		} else {
			wikiRel = ""
		}
	}

	var refs []Reference
	matches := wikiLinkRe.FindAllStringSubmatch(content, -1)
	for _, match := range matches {
		if len(match) < 2 {
			continue
		}
		href := match[1]

		// Skip external links
		if strings.HasPrefix(href, "http://") || strings.HasPrefix(href, "https://") ||
			strings.HasPrefix(href, "#") || strings.HasPrefix(href, "mailto:") {
			continue
		}
		// Skip image links
		for _, ext := range []string{".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"} {
			if strings.HasSuffix(strings.ToLower(href), ext) {
				continue
			}
		}

		resolved := rp.resolveWikiPath(href, wikiRel)
		if resolved == "" {
			continue
		}

		refs = append(refs, Reference{
			TargetPath: resolved,
			RefType:    "links_to",
			Page:       nil,
		})
	}
	return refs
}

// resolveWikiPath resolves a wiki link target using three fallback strategies:
// 1. Exact match in wikiPath index
// 2. Append .md and retry
// 3. Match by basename only
func (rp *ReferenceParser) resolveWikiPath(href, wikiRel string) string {
	// Resolve relative paths
	resolved := href
	if strings.HasPrefix(href, "/wiki/") {
		resolved = strings.TrimPrefix(href, "/wiki/")
	} else if strings.HasPrefix(href, "./") {
		resolved = wikiRel + href[2:]
	} else if strings.HasPrefix(href, "../") {
		parts := strings.Split(wikiRel+href, "/")
		var clean []string
		for _, p := range parts {
			if p == ".." {
				if len(clean) > 0 {
					clean = clean[:len(clean)-1]
				}
			} else if p != "." && p != "" {
				clean = append(clean, p)
			}
		}
		resolved = strings.Join(clean, "/")
	} else if !strings.Contains(href, "/") {
		resolved = wikiRel + href
	}

	resolvedLower := strings.ToLower(resolved)

	// Strategy 1: exact match
	if id, ok := rp.docsByWikiPath[resolvedLower]; ok {
		return id
	}

	// Strategy 2: append .md
	if id, ok := rp.docsByWikiPath[resolvedLower+".md"]; ok {
		return id
	}

	// Strategy 3: basename match
	basename := resolvedLower
	if idx := strings.LastIndex(basename, "/"); idx >= 0 {
		basename = basename[idx+1:]
	}
	for path, id := range rp.docsByWikiPath {
		pathBase := path
		if idx := strings.LastIndex(pathBase, "/"); idx >= 0 {
			pathBase = pathBase[idx+1:]
		}
		if pathBase == basename || pathBase == basename+".md" {
			return id
		}
	}

	return ""
}

// stripExtension removes the file extension from a filename.
func stripExtension(name string) string {
	for _, ext := range []string{".pdf", ".docx", ".doc", ".pptx", ".ppt", ".xlsx", ".xls", ".csv", ".html", ".htm", ".md", ".txt"} {
		if strings.HasSuffix(name, ext) {
			return name[:len(name)-len(ext)]
		}
	}
	if idx := strings.LastIndex(name, "."); idx > 0 {
		return name[:idx]
	}
	return name
}

// resolveFilename resolves a citation filename to a document ID.
func (rp *ReferenceParser) resolveFilename(filename string) string {
	fnLower := strings.ToLower(filename)

	if id, ok := rp.docsByFilename[fnLower]; ok {
		return id
	}

	base := stripExtension(fnLower)
	if id, ok := rp.docsByBase[base]; ok {
		return id
	}

	return ""
}

// parseCitationFile extracts filename and optional page from a citation string.
// Handles: "file.pdf, p.3", "file.pdf, p3", "file.pdf"
func parseCitationFile(raw string) (string, *int) {
	// Handle markdown links inside citations
	linkMatch := regexp.MustCompile(`\[([^\]]+)\]\([^)]*\)`).FindStringSubmatch(raw)
	if len(linkMatch) > 1 {
		raw = linkMatch[1]
	}

	// Match filename + optional page
	pageRe := regexp.MustCompile(`^(.+?)(?:,\s*p\.?\s*(\d+))?(?:\s*[-–—].*)?$`)
	parts := pageRe.FindStringSubmatch(raw)
	if len(parts) < 2 {
		return raw, nil
	}

	filename := strings.TrimSpace(parts[1])

	var page *int
	if len(parts) > 2 && parts[2] != "" {
		p := 0
		if _, err := fmt.Sscanf(parts[2], "%d", &p); err == nil {
			page = &p
		}
	}

	return filename, page
}
