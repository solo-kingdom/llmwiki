package sqlite

const (
	ConfigBackupIncludeRaw = "backup_include_raw"
	ConfigVCAutoPush       = "vc_auto_push"
	ConfigVCLastPushError  = "vc_last_push_error"
)

// BackupIncludeRaw returns whether raw/ is included in backup commits (default true).
func (d *DB) BackupIncludeRaw() bool {
	v, _ := d.GetConfig(ConfigBackupIncludeRaw)
	return v != "false"
}

// VCAutoPush returns whether to push after local commits.
func (d *DB) VCAutoPush() bool {
	v, _ := d.GetConfig(ConfigVCAutoPush)
	return v == "true"
}

// SetVCLastPushError records the last push error (empty clears).
func (d *DB) SetVCLastPushError(msg string) error {
	return d.SetConfig(ConfigVCLastPushError, msg)
}

// GetVCLastPushError returns the last push error message.
func (d *DB) GetVCLastPushError() string {
	v, _ := d.GetConfig(ConfigVCLastPushError)
	return v
}
