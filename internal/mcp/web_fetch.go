package mcp

import (
	"bytes"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	mdconv "github.com/JohannesKaufmann/html-to-markdown"
	readability "codeberg.org/readeck/go-readability/v2"
)

const (
	webFetchMaxURLs       = 5
	webFetchTimeout       = 15 * time.Second
	webFetchMaxRedirects  = 5
	webFetchMaxBodySize   = 2 * 1024 * 1024 // 2MB
	webFetchMaxResultSize = 50 * 1024        // 50KB per URL
	webFetchMaxTotalSize  = 200 * 1024       // 200KB total
	webFetchBaseDir       = "raw/sources/web-fetch"
)

var webFetchTool = Tool{
	Name:        DefaultToolWebFetch,
	Description: "Fetch and extract content from web pages. Returns readable Markdown text from the given URLs. Use this when the user shares a URL or asks about web content.",
	InputSchema: map[string]interface{}{
		"type": "object",
		"properties": map[string]interface{}{
			"urls": map[string]interface{}{
				"type":        "array",
				"items":       map[string]interface{}{"type": "string"},
				"description": "One or more URLs to fetch (max 5). Only HTTP and HTTPS are supported.",
			},
		},
		"required": []string{"urls"},
	},
}

// fetchResult holds the result of fetching a single URL.
type fetchResult struct {
	URL         string
	Title       string
	Content     string // Markdown content
	ContentType string
	SavedPath   string // Relative path where content was persisted
	Error       string // Non-fatal error message
}

// executeWebFetch is the main entry point for the web_fetch tool.
func executeWebFetch(workspace string, args map[string]interface{}) (string, error) {
	urls, err := parseURLs(args)
	if err != nil {
		return err.Error(), nil
	}

	if len(urls) > webFetchMaxURLs {
		return fmt.Sprintf("Error: too many URLs (%d). Maximum is %d.", len(urls), webFetchMaxURLs), nil
	}

	var results []fetchResult
	for _, u := range urls {
		result := fetchAndExtractURL(workspace, u)
		results = append(results, result)
	}

	totalSize := 0
	var sb strings.Builder
	for i, r := range results {
		if i > 0 {
			sb.WriteString("\n---\n\n")
		}
		content := formatFetchResult(r)
		// Truncate per-URL result
		if len(content) > webFetchMaxResultSize {
			content = content[:webFetchMaxResultSize] + "\n\n[...content truncated at 50KB]"
		}
		// Check total size
		if totalSize+len(content) > webFetchMaxTotalSize {
			remaining := webFetchMaxTotalSize - totalSize
			if remaining > 0 {
				sb.WriteString(content[:remaining])
				sb.WriteString("\n\n[...total output truncated at 200KB]")
			}
			break
		}
		sb.WriteString(content)
		totalSize += len(content)
	}

	return sb.String(), nil
}

// parseURLs extracts URL strings from tool arguments.
func parseURLs(args map[string]interface{}) ([]string, error) {
	raw, ok := args["urls"]
	if !ok {
		return nil, fmt.Errorf("Error: 'urls' parameter is required")
	}

	switch v := raw.(type) {
	case string:
		if strings.TrimSpace(v) == "" {
			return nil, fmt.Errorf("Error: 'urls' parameter cannot be empty")
		}
		return []string{v}, nil
	case []interface{}:
		if len(v) == 0 {
			return nil, fmt.Errorf("Error: 'urls' parameter cannot be empty")
		}
		var urls []string
		for _, item := range v {
			s, ok := item.(string)
			if !ok {
				return nil, fmt.Errorf("Error: each URL must be a string")
			}
			urls = append(urls, s)
		}
		return urls, nil
	default:
		return nil, fmt.Errorf("Error: 'urls' must be a string or array of strings")
	}
}

// fetchAndExtractURL fetches a single URL, extracts content, and persists it.
func fetchAndExtractURL(workspace, rawURL string) fetchResult {
	result := fetchResult{URL: rawURL}

	// Validate URL scheme
	parsed, err := url.Parse(rawURL)
	if err != nil {
		result.Error = fmt.Sprintf("invalid URL: %v", err)
		return result
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		result.Error = fmt.Sprintf("unsupported scheme %q: only http and https are allowed", parsed.Scheme)
		return result
	}

	// HTTP GET with timeout and redirect limit
	client := &http.Client{
		Timeout: webFetchTimeout,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= webFetchMaxRedirects {
				return fmt.Errorf("too many redirects (>%d)", webFetchMaxRedirects)
			}
			return nil
		},
	}

	resp, err := client.Get(rawURL)
	if err != nil {
		if strings.Contains(err.Error(), "timeout") || strings.Contains(err.Error(), "deadline") {
			result.Error = "fetch timeout after 15s"
		} else {
			result.Error = fmt.Sprintf("fetch error: %v", err)
		}
		return result
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		result.Error = fmt.Sprintf("HTTP %d: %s", resp.StatusCode, http.StatusText(resp.StatusCode))
		return result
	}

	// Read body with size limit
	bodyReader := io.LimitReader(resp.Body, webFetchMaxBodySize+1)
	body, err := io.ReadAll(bodyReader)
	if err != nil {
		result.Error = fmt.Sprintf("read error: %v", err)
		return result
	}
	if len(body) > webFetchMaxBodySize {
		result.Error = fmt.Sprintf("response body exceeds %d bytes limit", webFetchMaxBodySize)
		return result
	}

	// Check Content-Type
	contentType := resp.Header.Get("Content-Type")
	ctLower := strings.ToLower(contentType)
	result.ContentType = contentType

	switch {
	case strings.Contains(ctLower, "text/html"):
		result.Content, result.Title = extractHTMLContent(rawURL, body)
	case strings.Contains(ctLower, "text/plain"):
		result.Content = string(body)
		result.Title = extractTitleFromURL(rawURL)
	default:
		result.Error = fmt.Sprintf("unsupported content type: %s", contentType)
		return result
	}

	// Persist to disk
	if workspace != "" && result.Content != "" {
		savedPath, err := persistFetchResult(workspace, result)
		if err != nil {
			log.Printf("web_fetch: failed to persist %s: %v", rawURL, err)
		} else {
			result.SavedPath = savedPath
		}
	}

	return result
}

// extractHTMLContent uses readability to extract article content, then converts to Markdown.
func extractHTMLContent(pageURL string, body []byte) (markdown string, title string) {
	parsedURL, err := url.Parse(pageURL)
	if err != nil {
		parsedURL = nil
	}

	// Try readability extraction first
	article, err := readability.FromReader(bytes.NewReader(body), parsedURL)
	if err == nil && article.Node != nil {
		title = article.Title()

		// Render the extracted article HTML to Markdown
		var htmlBuf bytes.Buffer
		if renderErr := article.RenderHTML(&htmlBuf); renderErr == nil && htmlBuf.Len() > 0 {
			md, convErr := convertHTMLToMarkdown(htmlBuf.String())
			if convErr == nil {
				return md, title
			}
		}

		// Fallback: render as plain text
		var textBuf bytes.Buffer
		if renderErr := article.RenderText(&textBuf); renderErr == nil && textBuf.Len() > 0 {
			return textBuf.String(), title
		}
	}

	// Fallback: convert entire page HTML to Markdown
	title = extractTitleFromURL(pageURL)
	md, err := convertHTMLToMarkdown(string(body))
	if err != nil {
		return string(body), title
	}
	return md, title
}

// convertHTMLToMarkdown converts HTML string to Markdown.
func convertHTMLToMarkdown(htmlContent string) (string, error) {
	converter := mdconv.NewConverter("", true, nil)
	return converter.ConvertString(htmlContent)
}

// extractTitleFromURL derives a title from the URL path.
func extractTitleFromURL(rawURL string) string {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return rawURL
	}
	path := strings.TrimSuffix(parsed.Path, "/")
	path = filepath.Base(path)
	// Remove file extension
	if idx := strings.LastIndex(path, "."); idx > 0 {
		path = path[:idx]
	}
	// Replace hyphens/underscores with spaces
	path = strings.ReplaceAll(path, "-", " ")
	path = strings.ReplaceAll(path, "_", " ")
	if path == "" || path == "." || path == "/" {
		return parsed.Host
	}
	return path
}

// urlSlug creates a filesystem-safe slug from a URL path.
var nonAlphaNum = regexp.MustCompile(`[^a-z0-9]+`)

func urlSlug(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	s = nonAlphaNum.ReplaceAllString(s, "-")
	s = strings.Trim(s, "-")
	if s == "" {
		return "index"
	}
	// Limit length
	if len(s) > 80 {
		s = s[:80]
	}
	return s
}

// formatFetchResult formats a single fetch result into Markdown text.
func formatFetchResult(r fetchResult) string {
	var sb strings.Builder

	sb.WriteString(fmt.Sprintf("## %s\n", r.URL))
	if r.Title != "" {
		sb.WriteString(fmt.Sprintf("> Title: %s\n", r.Title))
	}
	sb.WriteString(fmt.Sprintf("> Fetched: %s\n", time.Now().Format(time.RFC3339)))
	if r.SavedPath != "" {
		sb.WriteString(fmt.Sprintf("> Saved: %s\n", r.SavedPath))
	}
	sb.WriteString("\n")

	if r.Error != "" {
		sb.WriteString(fmt.Sprintf("⚠️ Error: %s\n", r.Error))
	} else {
		sb.WriteString(r.Content)
	}

	return sb.String()
}

// persistFetchResult saves fetched content to disk with YAML frontmatter.
func persistFetchResult(workspace string, r fetchResult) (string, error) {
	if r.Content == "" {
		return "", fmt.Errorf("no content to persist")
	}

	parsed, err := url.Parse(r.URL)
	if err != nil {
		return "", fmt.Errorf("invalid URL for persistence: %v", err)
	}
	domain := parsed.Host
	if domain == "" {
		domain = "unknown"
	}

	slug := urlSlug(parsed.Path)
	if slug == "" {
		slug = "index"
	}
	timestamp := time.Now().Format("20060102-150405")
	filename := fmt.Sprintf("%s-%s.md", slug, timestamp)

	relPath := filepath.ToSlash(filepath.Join(webFetchBaseDir, domain, filename))
	fullPath := filepath.Join(workspace, relPath)

	// Build content with YAML frontmatter
	var content strings.Builder
	content.WriteString("---\n")
	content.WriteString(fmt.Sprintf("source_url: %s\n", r.URL))
	content.WriteString(fmt.Sprintf("title: %q\n", r.Title))
	content.WriteString(fmt.Sprintf("fetched_at: %s\n", time.Now().Format(time.RFC3339)))
	content.WriteString(fmt.Sprintf("content_type: %s\n", r.ContentType))
	content.WriteString("---\n\n")
	content.WriteString(r.Content)

	// Ensure directory exists
	dir := filepath.Dir(fullPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return "", fmt.Errorf("create directory: %w", err)
	}

	// Atomic write: temp file then rename
	tmpFile, err := os.CreateTemp(dir, ".llmwiki-fetch-*")
	if err != nil {
		return "", fmt.Errorf("create temp file: %w", err)
	}
	tmpPath := tmpFile.Name()

	if _, err := tmpFile.WriteString(content.String()); err != nil {
		tmpFile.Close()
		os.Remove(tmpPath)
		return "", fmt.Errorf("write temp file: %w", err)
	}
	tmpFile.Close()

	if err := os.Rename(tmpPath, fullPath); err != nil {
		os.Remove(tmpPath)
		return "", fmt.Errorf("rename temp file: %w", err)
	}

	return relPath, nil
}
