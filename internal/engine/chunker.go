// Package engine provides core processing logic for LLM Wiki.
package engine

import (
	"math"
	"regexp"
	"strings"
	"unicode"
)

// Chunk represents a text segment for indexing.
type Chunk struct {
	Index           int
	Content         string
	Page            int
	StartChar       int
	TokenCount      int
	HeaderBreadcrumb string
}

// ChunkConfig controls chunking behavior.
type ChunkConfig struct {
	ChunkSize    int // target token count (default 512)
	ChunkOverlap int // token overlap between chunks (default 128)
	MinTokens    int // minimum tokens to keep a chunk (default 32)
}

// DefaultChunkConfig returns the standard chunking configuration.
func DefaultChunkConfig() ChunkConfig {
	return ChunkConfig{
		ChunkSize:    512,
		ChunkOverlap: 128,
		MinTokens:    32,
	}
}

// EstimateTokens provides a rough token count: ~1 token per 4 characters.
// This is a heuristic; for production use, a proper tokenizer should be used.
func EstimateTokens(text string) int {
	count := len([]rune(text))
	return max(1, count/4)
}

// ChunkText splits text into overlapping chunks for indexing.
func ChunkText(text string, page int, cfg ChunkConfig) []Chunk {
	if text == "" {
		return nil
	}

	// Split into paragraphs first
	paragraphs := splitParagraphs(text)

	// Track headers for breadcrumbs
	headerStack := []headerItem{}
	headerRegex := regexp.MustCompile(`^(#{1,6})\s+(.+)$`)

	var chunks []Chunk
	chunkIndex := 0
	currentTokens := 0
	currentChunk := strings.Builder{}
	currentStartChar := 0
	currentBreadcrumb := ""
	overlapBuffer := ""

	for _, para := range paragraphs {
		// Check for headers
		if match := headerRegex.FindStringSubmatch(para); match != nil {
			level := len(match[1])
			heading := strings.TrimSpace(match[2])
			// Update header stack
			newStack := make([]headerItem, 0)
			for _, h := range headerStack {
				if h.level < level {
					newStack = append(newStack, h)
				}
			}
			newStack = append(newStack, headerItem{level, heading})
			headerStack = newStack

			// Build breadcrumb
			parts := make([]string, len(headerStack))
			for i, h := range headerStack {
				parts[i] = h.text
			}
			currentBreadcrumb = strings.Join(parts, " > ")
		}

		paraTokens := EstimateTokens(para)

		// If paragraph alone exceeds chunk size, split by sentences
		if paraTokens > cfg.ChunkSize {
			sentences := splitSentences(para)
			for _, sent := range sentences {
				sentTokens := EstimateTokens(sent)
				if currentTokens+sentTokens > cfg.ChunkSize && currentChunk.Len() > 0 {
					// Emit current chunk
					content := currentChunk.String()
					chunks = append(chunks, Chunk{
						Index:           chunkIndex,
						Content:         content,
						Page:            page,
						StartChar:       currentStartChar,
						TokenCount:      currentTokens,
						HeaderBreadcrumb: currentBreadcrumb,
					})
					chunkIndex++
					// Start new chunk with overlap
					currentChunk.Reset()
					currentTokens = 0
					if overlapBuffer != "" {
						currentChunk.WriteString(overlapBuffer)
						currentChunk.WriteString(" ")
						currentTokens = EstimateTokens(overlapBuffer)
					}
				}
				currentChunk.WriteString(sent)
				currentChunk.WriteString(" ")
				currentTokens += sentTokens
				overlapBuffer = sent
			}
			continue
		}

		// If adding this paragraph would exceed chunk size, emit and start new
		if currentTokens+paraTokens > cfg.ChunkSize && currentChunk.Len() > 0 {
			content := currentChunk.String()
			if EstimateTokens(content) >= cfg.MinTokens {
				chunks = append(chunks, Chunk{
					Index:           chunkIndex,
					Content:         content,
					Page:            page,
					StartChar:       currentStartChar,
					TokenCount:      currentTokens,
					HeaderBreadcrumb: currentBreadcrumb,
				})
				chunkIndex++
			}
			currentChunk.Reset()
			currentTokens = 0
		}

		currentChunk.WriteString(para)
		currentChunk.WriteString("\n\n")
		currentTokens += paraTokens
	}

	// Emit final chunk
	if currentChunk.Len() > 0 {
		content := strings.TrimSpace(currentChunk.String())
		if EstimateTokens(content) >= cfg.MinTokens {
			chunks = append(chunks, Chunk{
				Index:           chunkIndex,
				Content:         content,
				Page:            page,
				StartChar:       currentStartChar,
				TokenCount:      currentTokens,
				HeaderBreadcrumb: currentBreadcrumb,
			})
		}
	}

	return chunks
}

type headerItem struct {
	level int
	text  string
}

// splitParagraphs splits text by double newlines.
func splitParagraphs(text string) []string {
	parts := regexp.MustCompile(`\n\s*\n`).Split(text, -1)
	result := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			result = append(result, p)
		}
	}
	return result
}

// splitSentences splits text by sentence boundaries.
func splitSentences(text string) []string {
	// Split on Chinese/English sentence endings
	re := regexp.MustCompile(`([。！？.!?\n])\s*`)
	parts := re.Split(text, -1)
	matches := re.FindAllString(text, -1)

	result := make([]string, 0, len(parts))
	for i, part := range parts {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		if i < len(matches) {
			// Extract delimiter character
			delim := strings.TrimSpace(matches[i])
			if delim != "" {
				r := []rune(delim)
				part += string(r[0])
			}
		}
		// If too long, split by fixed size
		if len([]rune(part)) > 10000 {
			runes := []rune(part)
			for j := 0; j < len(runes); j += 5000 {
				end := int(math.Min(float64(j+5000), float64(len(runes))))
				result = append(result, string(runes[j:end]))
			}
		} else {
			result = append(result, part)
		}
	}
	return result
}

// IsCJK reports whether a rune is a CJK character.
func IsCJK(r rune) bool {
	return unicode.In(r,
		unicode.Han,
		unicode.Hiragana,
		unicode.Katakana,
	)
}
