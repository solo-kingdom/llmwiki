package api

import (
	"github.com/solo-kingdom/llmwiki/internal/activity"
	"github.com/solo-kingdom/llmwiki/internal/vcs"
	"github.com/solo-kingdom/llmwiki/internal/workspace"
)

// runWorkspaceBackup exports settings and creates a backup track commit when git is initialized.
func (a *API) runWorkspaceBackup() (string, error) {
	if a.workspace == "" || a.db == nil {
		return "", nil
	}
	_ = workspace.ExportSettings(a.db, a.workspace)

	repo := vcs.NewGitRepo(a.workspace)
	if !repo.IsInitialized() {
		return "", nil
	}

	includeRaw := a.db.BackupIncludeRaw()
	sha, err := repo.BackupCommit(includeRaw)
	if err != nil {
		return "", err
	}
	if sha != "" {
		vcs.TryAutoPush(repo, a.db)
		activity.Record(a.db, activity.Entry{
			Level:    "info",
			Category: "vcs",
			Action:   "backup",
			Message:  "工作区备份快照已提交",
			Status:   "success",
			Source:   "api",
		})
	}
	return sha, nil
}
