package vcs

// AutoPushConfig reads auto-push preference and records push errors.
type AutoPushConfig interface {
	VCAutoPush() bool
	SetVCLastPushError(msg string) error
}

// TryAutoPush pushes to origin when auto-push is enabled and remote is configured.
func TryAutoPush(repo *GitRepo, cfg AutoPushConfig) {
	if cfg == nil || !cfg.VCAutoPush() {
		return
	}
	remote, err := repo.RemoteStatus()
	if err != nil || remote == nil || !remote.Configured {
		return
	}
	if err := repo.Push(); err != nil {
		_ = cfg.SetVCLastPushError(err.Error())
		return
	}
	_ = cfg.SetVCLastPushError("")
}
