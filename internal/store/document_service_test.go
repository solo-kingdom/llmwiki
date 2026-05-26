package service

import (
	"os"
	"path/filepath"
	"testing"
)

func TestSlugifyTitle(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"Hello World", "hello-world"},
		{"My Page Title!", "my-page-title"},
		{"  spaces  ", "spaces"},
		{"underscores_and-dashes", "underscoresand-dashes"},
		{"UPPERCASE", "uppercase"},
		{"special@#chars", "specialchars"},
		{"", "untitled"},
		{"  ", "untitled"},
		{"中文标题", "untitled"}, // non-alnum gets stripped
		{"mix 中文 with english", "mix-with-english"},
	}
	for _, tt := range tests {
		got := SlugifyTitle(tt.input)
		if got != tt.want {
			t.Errorf("SlugifyTitle(%q) = %q, want %q", tt.input, got, tt.want)
		}
	}
}

func TestFilenameFromTitle(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"Hello World", "hello-world.md"},
		{"", "untitled.md"},
		{"My Page", "my-page.md"},
	}
	for _, tt := range tests {
		got := FilenameFromTitle(tt.input)
		if got != tt.want {
			t.Errorf("FilenameFromTitle(%q) = %q, want %q", tt.input, got, tt.want)
		}
	}
}

func TestResolvePath(t *testing.T) {
	tests := []struct {
		input      string
		wantDir    string
		wantFile   string
	}{
		{"", "/wiki/", ""},
		{"/", "/wiki/", ""},
		{"concepts/attention.md", "/concepts/", "attention.md"},
		{"/wiki/page.md", "/wiki/", "page.md"},
		{"concepts", "/concepts/", "concepts"},
		{"/wiki/sub/page.md", "/wiki/sub/", "page.md"},
	}
	for _, tt := range tests {
		dir, file := ResolvePath(tt.input)
		if dir != tt.wantDir || file != tt.wantFile {
			t.Errorf("ResolvePath(%q) = (%q, %q), want (%q, %q)", tt.input, dir, file, tt.wantDir, tt.wantFile)
		}
	}
}

func TestIsProtectedFile(t *testing.T) {
	tests := []struct {
		dir      string
		filename string
		want     bool
	}{
		{"/wiki/", "overview.md", true},
		{"/wiki/", "log.md", true},
		{"/wiki/", "other.md", false},
		{"/wiki/sub/", "overview.md", false},
		{"/sources/", "overview.md", false},
	}
	for _, tt := range tests {
		got := IsProtectedFile(tt.dir, tt.filename)
		if got != tt.want {
			t.Errorf("IsProtectedFile(%q, %q) = %v, want %v", tt.dir, tt.filename, got, tt.want)
		}
	}
}

func TestValidatePath(t *testing.T) {
	tests := []struct {
		input   string
		wantErr bool
	}{
		{"wiki/page.md", false},
		{"concepts/test", false},
		{"../etc/passwd", true},
		{"foo/../../bar", true},
		{"/absolute/path", true},
		{"normal/file.md", false},
	}
	for _, tt := range tests {
		err := ValidatePath(tt.input)
		if (err != nil) != tt.wantErr {
			t.Errorf("ValidatePath(%q) error = %v, wantErr %v", tt.input, err, tt.wantErr)
		}
	}
}

func TestDocumentServiceWorkspace(t *testing.T) {
	dir := t.TempDir()
	svc := NewDocumentService(dir)
	if svc.Workspace != dir {
		t.Errorf("expected Workspace=%q, got %q", dir, svc.Workspace)
	}
}

func TestIntegrationDocumentWorkflow(t *testing.T) {
	// Create a temporary workspace with wiki/ directory
	workspace := t.TempDir()
	wikiDir := filepath.Join(workspace, "wiki")
	if err := os.MkdirAll(wikiDir, 0755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}

	svc := NewDocumentService(workspace)
	_ = svc

	// Test the full document workflow:
	// 1. Create a title → get filename
	title := "My Test Page"
	filename := FilenameFromTitle(title)
	if filename != "my-test-page.md" {
		t.Fatalf("unexpected filename: %q", filename)
	}

	// 2. Resolve path
	dirPath, fname := ResolvePath("wiki/" + filename)
	if fname != filename {
		t.Errorf("ResolvePath filename = %q, want %q", fname, filename)
	}

	// 3. Validate path is safe
	if err := ValidatePath("wiki/" + filename); err != nil {
		t.Fatalf("ValidatePath error: %v", err)
	}

	// 4. Check it's not a protected file
	if IsProtectedFile(dirPath, fname) {
		t.Error("should not be a protected file")
	}

	// 5. Write file to filesystem
	content := "---\ntitle: My Test Page\ntags: [test]\n---\n\n# Hello World\n\nSome content."
	filePath := filepath.Join(workspace, "wiki", filename)
	if err := os.WriteFile(filePath, []byte(content), 0644); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}

	// 6. Read and parse frontmatter
	data, err := os.ReadFile(filePath)
	if err != nil {
		t.Fatalf("ReadFile: %v", err)
	}

	fm := ParseFrontmatter(string(data))
	if fm.Title != "My Test Page" {
		t.Errorf("frontmatter title = %q, want 'My Test Page'", fm.Title)
	}
	if len(fm.Tags) != 1 || fm.Tags[0] != "test" {
		t.Errorf("frontmatter tags = %v, want ['test']", fm.Tags)
	}

	// 7. Derive title from filename
	derived := TitleFromFilename(filename)
	if derived != "My Test Page" {
		t.Errorf("TitleFromFilename = %q, want 'My Test Page'", derived)
	}
}

func TestIntegrationProtectedFilesWorkflow(t *testing.T) {
	workspace := t.TempDir()
	wikiDir := filepath.Join(workspace, "wiki")
	if err := os.MkdirAll(wikiDir, 0755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}

	// Create overview.md and log.md
	for _, name := range []string{"overview.md", "log.md"} {
		path := filepath.Join(wikiDir, name)
		if err := os.WriteFile(path, []byte("# "+name), 0644); err != nil {
			t.Fatalf("WriteFile %s: %v", name, err)
		}
	}

	_ = NewDocumentService(workspace)

	// Verify protected files
	if !IsProtectedFile("/wiki/", "overview.md") {
		t.Error("overview.md should be protected")
	}
	if !IsProtectedFile("/wiki/", "log.md") {
		t.Error("log.md should be protected")
	}

	// Verify non-protected files
	if IsProtectedFile("/wiki/", "other.md") {
		t.Error("other.md should not be protected")
	}
	if IsProtectedFile("/wiki/sub/", "overview.md") {
		t.Error("overview.md in subdirectory should not be protected")
	}
}
