package acp

import (
	"os"
	"path/filepath"
	"testing"
)

func TestResolveCWDWorkspace(t *testing.T) {
	workspace := t.TempDir()
	got, err := ResolveCWD(workspace, "session", DefaultCWDPolicy)
	if err != nil {
		t.Fatalf("ResolveCWD: %v", err)
	}
	if !filepath.IsAbs(got) || got != workspace {
		t.Fatalf("cwd = %q, want absolute workspace %q", got, workspace)
	}
}

func TestResolveCWDSession(t *testing.T) {
	workspace := t.TempDir()
	got, err := ResolveCWD(workspace, "session-1", "session")
	if err != nil {
		t.Fatalf("ResolveCWD: %v", err)
	}
	want := filepath.Join(workspace, ".llmwiki", "cache", "acp", "sessions", "session-1")
	if got != want {
		t.Fatalf("cwd = %q, want %q", got, want)
	}
	info, err := os.Stat(got)
	if err != nil {
		t.Fatalf("stat cwd: %v", err)
	}
	if info.Mode().Perm() != 0o700 {
		t.Fatalf("cwd mode = %o, want 700", info.Mode().Perm())
	}
}

func TestResolveCWDRejectsSessionPathTraversal(t *testing.T) {
	if _, err := ResolveCWD(t.TempDir(), "../escape", "session"); err == nil {
		t.Fatal("expected path traversal error")
	}
}

func TestAssertWithinWorkspaceRejectsSymlinkEscape(t *testing.T) {
	workspace := t.TempDir()
	outside := t.TempDir()
	link := filepath.Join(workspace, "escape")
	if err := os.Symlink(outside, link); err != nil {
		t.Fatalf("symlink: %v", err)
	}
	if err := assertWithinWorkspace(workspace, link); err == nil {
		t.Fatal("expected symlink escape error")
	}
}

func TestResolveCWDRejectsEmptyWorkspace(t *testing.T) {
	if _, err := ResolveCWD("", "session", "workspace"); err == nil {
		t.Fatal("expected empty workspace error")
	}
}
