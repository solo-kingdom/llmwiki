package vcs

import (
	"fmt"
	"strconv"
	"strings"
)

// RemoteStatus describes configured git remote and branch sync state.
type RemoteStatus struct {
	Configured bool   `json:"configured"`
	URL        string `json:"url,omitempty"`
	Branch     string `json:"branch,omitempty"`
	Ahead      int    `json:"ahead"`
	Behind     int    `json:"behind"`
}

// SetRemote adds or updates origin URL.
func (r *GitRepo) SetRemote(url string) error {
	url = strings.TrimSpace(url)
	if url == "" {
		return fmt.Errorf("remote URL is required")
	}

	out, err := r.gitOutput("remote", "get-url", "origin")
	if err != nil || strings.TrimSpace(out) == "" {
		return r.runGit("remote", "add", "origin", url)
	}
	return r.runGit("remote", "set-url", "origin", url)
}

// Push pushes the current branch to origin.
func (r *GitRepo) Push() error {
	branch, err := r.currentBranch()
	if err != nil {
		return err
	}
	if branch == "" {
		return fmt.Errorf("cannot determine current branch")
	}
	return r.runGit("push", "-u", "origin", branch)
}

// RemoteStatus returns origin configuration and ahead/behind counts when available.
func (r *GitRepo) RemoteStatus() (*RemoteStatus, error) {
	st := &RemoteStatus{}
	url, err := r.gitOutput("remote", "get-url", "origin")
	if err != nil || strings.TrimSpace(url) == "" {
		return st, nil
	}
	st.Configured = true
	st.URL = strings.TrimSpace(url)

	branch, err := r.currentBranch()
	if err == nil {
		st.Branch = branch
	}

	// Fetch is intentionally not run; rev-parse works for local ahead when upstream exists.
	upstream, err := r.gitOutput("rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}")
	if err != nil || strings.TrimSpace(upstream) == "" {
		return st, nil
	}

	aheadOut, err := r.gitOutput("rev-list", "--count", "@{u}..HEAD")
	if err == nil {
		st.Ahead, _ = strconv.Atoi(strings.TrimSpace(aheadOut))
	}
	behindOut, err := r.gitOutput("rev-list", "--count", "HEAD..@{u}")
	if err == nil {
		st.Behind, _ = strconv.Atoi(strings.TrimSpace(behindOut))
	}
	return st, nil
}

func (r *GitRepo) currentBranch() (string, error) {
	out, err := r.gitOutput("rev-parse", "--abbrev-ref", "HEAD")
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(out), nil
}
