package mcp

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// sampleHTML is a minimal HTML page for testing readability extraction.
const sampleHTML = `<!DOCTYPE html>
<html>
<head><title>Test Article</title></head>
<body>
<nav>Navigation Link 1 | Navigation Link 2</nav>
<article>
<h1>Test Article Title</h1>
<p>This is the first paragraph of the article. It contains some meaningful content for testing readability extraction.</p>
<p>This is the second paragraph with more content. The quick brown fox jumps over the lazy dog.</p>
<ul>
<li>Item one</li>
<li>Item two</li>
<li>Item three</li>
</ul>
</article>
<footer>Footer content that should be removed</footer>
</body>
</html>`

func TestFetchAndExtractURL(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		fmt.Fprint(w, sampleHTML)
	}))
	defer server.Close()

	tmpDir := t.TempDir()
	result := fetchAndExtractURL(tmpDir, server.URL)

	if result.Error != "" {
		t.Fatalf("unexpected error: %s", result.Error)
	}
	if result.Title == "" {
		t.Error("expected non-empty title")
	}
	if result.Content == "" {
		t.Error("expected non-empty content")
	}
	// Content should include article text, not nav/footer
	if strings.Contains(result.Content, "Navigation Link") {
		t.Error("content should not contain navigation text")
	}
	if strings.Contains(result.Content, "Footer content") {
		t.Error("content should not contain footer text")
	}
	// Content should include article content
	if !strings.Contains(result.Content, "first paragraph") {
		t.Error("content should contain article text")
	}
	// Check file was persisted
	if result.SavedPath == "" {
		t.Fatal("expected SavedPath to be set")
	}
	fullPath := filepath.Join(tmpDir, result.SavedPath)
	if _, err := os.Stat(fullPath); os.IsNotExist(err) {
		t.Errorf("persisted file not found: %s", fullPath)
	}
	// Check frontmatter
	data, err := os.ReadFile(fullPath)
	if err != nil {
		t.Fatal(err)
	}
	content := string(data)
	if !strings.HasPrefix(content, "---\n") {
		t.Error("file should start with YAML frontmatter")
	}
	if !strings.Contains(content, "source_url:") {
		t.Error("frontmatter should contain source_url")
	}
	if !strings.Contains(content, "fetched_at:") {
		t.Error("frontmatter should contain fetched_at")
	}
}

func TestFetchAndExtractURLPlainText(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		fmt.Fprint(w, "This is plain text content.\nLine two.")
	}))
	defer server.Close()

	tmpDir := t.TempDir()
	result := fetchAndExtractURL(tmpDir, server.URL)

	if result.Error != "" {
		t.Fatalf("unexpected error: %s", result.Error)
	}
	if result.Content != "This is plain text content.\nLine two." {
		t.Errorf("unexpected content: %q", result.Content)
	}
}

func TestFetchAndExtractURLErrors(t *testing.T) {
	tests := []struct {
		name        string
		url         string
		handler     http.HandlerFunc
		wantError   string
	}{
		{
			name:      "unsupported scheme ftp",
			url:       "ftp://example.com/file",
			handler:   nil,
			wantError: "unsupported scheme",
		},
		{
			name:      "unsupported scheme file",
			url:       "file:///etc/passwd",
			handler:   nil,
			wantError: "unsupported scheme",
		},
		{
			name: "HTTP 404",
			url:  "", // will be set to server URL
			handler: func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(http.StatusNotFound)
				fmt.Fprint(w, "Not Found")
			},
			wantError: "HTTP 404",
		},
		{
			name: "unsupported content type",
			url:  "", // will be set to server URL
			handler: func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/pdf")
				fmt.Fprint(w, "PDF content")
			},
			wantError: "unsupported content type",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.handler != nil {
				server := httptest.NewServer(tt.handler)
				defer server.Close()
				if tt.url == "" {
					tt.url = server.URL
				}
			}

			result := fetchAndExtractURL(t.TempDir(), tt.url)
			if result.Error == "" {
				t.Fatalf("expected error containing %q, got none", tt.wantError)
			}
			if !strings.Contains(result.Error, tt.wantError) {
				t.Errorf("error %q should contain %q", result.Error, tt.wantError)
			}
		})
	}
}

func TestExecuteWebFetchMultipleURLs(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		fmt.Fprintf(w, `<!DOCTYPE html><html><head><title>%s</title></head><body><article><h1>%s</h1><p>Content for %s</p></article></body></html>`, r.URL.Path, r.URL.Path, r.URL.Path)
	}))
	defer server.Close()

	tmpDir := t.TempDir()
	output, err := executeWebFetch(tmpDir, map[string]interface{}{
		"urls": []interface{}{
			server.URL + "/page1",
			server.URL + "/page2",
		},
	})
	if err != nil {
		t.Fatal(err)
	}

	if !strings.Contains(output, server.URL+"/page1") {
		t.Error("output should contain first URL")
	}
	if !strings.Contains(output, server.URL+"/page2") {
		t.Error("output should contain second URL")
	}
	if !strings.Contains(output, "---") {
		t.Error("multiple results should be separated by ---")
	}
}

func TestExecuteWebFetchMultipleURLsWithError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain")
		fmt.Fprint(w, "OK content")
	}))
	defer server.Close()

	tmpDir := t.TempDir()
	output, err := executeWebFetch(tmpDir, map[string]interface{}{
		"urls": []interface{}{
			server.URL + "/good",
			"ftp://invalid.example.com/bad",
		},
	})
	if err != nil {
		t.Fatal(err)
	}

	// Should contain the good result
	if !strings.Contains(output, "OK content") {
		t.Error("output should contain successful fetch result")
	}
	// Should contain the error for the bad URL
	if !strings.Contains(output, "unsupported scheme") {
		t.Error("output should contain error for invalid URL")
	}
}

func TestExecuteWebFetchURLLimit(t *testing.T) {
	tmpDir := t.TempDir()

	// Build 6 URLs
	urls := make([]interface{}, 6)
	for i := range urls {
		urls[i] = fmt.Sprintf("http://example.com/page%d", i)
	}

	output, err := executeWebFetch(tmpDir, map[string]interface{}{
		"urls": urls,
	})
	if err != nil {
		t.Fatal(err)
	}

	if !strings.Contains(output, "too many URLs") {
		t.Errorf("expected 'too many URLs' error, got: %s", output)
	}
}

func TestParseURLs(t *testing.T) {
	tests := []struct {
		name    string
		args    map[string]interface{}
		want    []string
		wantErr bool
	}{
		{
			name:    "single string URL",
			args:    map[string]interface{}{"urls": "http://example.com"},
			want:    []string{"http://example.com"},
			wantErr: false,
		},
		{
			name:    "array of URLs",
			args:    map[string]interface{}{"urls": []interface{}{"http://a.com", "http://b.com"}},
			want:    []string{"http://a.com", "http://b.com"},
			wantErr: false,
		},
		{
			name:    "missing urls parameter",
			args:    map[string]interface{}{},
			want:    nil,
			wantErr: true,
		},
		{
			name:    "empty string",
			args:    map[string]interface{}{"urls": "  "},
			want:    nil,
			wantErr: true,
		},
		{
			name:    "empty array",
			args:    map[string]interface{}{"urls": []interface{}{}},
			want:    nil,
			wantErr: true,
		},
		{
			name:    "invalid type",
			args:    map[string]interface{}{"urls": 42},
			want:    nil,
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := parseURLs(tt.args)
			if (err != nil) != tt.wantErr {
				t.Errorf("parseURLs() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if tt.wantErr {
				return
			}
			if len(got) != len(tt.want) {
				t.Errorf("parseURLs() = %v, want %v", got, tt.want)
				return
			}
			for i := range got {
				if got[i] != tt.want[i] {
					t.Errorf("parseURLs()[%d] = %v, want %v", i, got[i], tt.want[i])
				}
			}
		})
	}
}

func TestURLSlug(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"/path/to/article", "path-to-article"},
		{"/", "index"},
		{"", "index"},
		{"/UPPERCASE/Path", "uppercase-path"},
		{"/path/with/unicode/中文", "path-with-unicode"},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got := urlSlug(tt.input)
			if got != tt.want {
				t.Errorf("urlSlug(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}
