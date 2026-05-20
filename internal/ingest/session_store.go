package ingest

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
)

const SessionBaseDir = "raw/sources/web-ingest/sessions"

// DefaultIngestSessionTitle returns the default session name: "#{no} {date}".
func DefaultIngestSessionTitle(no int, now time.Time) string {
	return fmt.Sprintf("#%d %s", no, now.Format("2006-01-02"))
}

// SessionDir returns the relative session root path.
func SessionDir(sessionID string) string {
	return filepath.ToSlash(filepath.Join(SessionBaseDir, sessionID))
}

func SessionAttachmentsDir(sessionID string) string {
	return filepath.ToSlash(filepath.Join(SessionDir(sessionID), "attachments"))
}

// RemoveSessionDir deletes the session directory tree under workspace.
func RemoveSessionDir(workspace, sessionID string) error {
	if strings.TrimSpace(workspace) == "" || strings.TrimSpace(sessionID) == "" {
		return nil
	}
	abs := filepath.Join(workspace, filepath.FromSlash(SessionDir(sessionID)))
	if err := os.RemoveAll(abs); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

// EnsureSessionDirs creates session and attachments directories under workspace.
func EnsureSessionDirs(workspace, sessionID string) (string, error) {
	if strings.TrimSpace(workspace) == "" {
		return "", fmt.Errorf("workspace not configured")
	}
	if strings.TrimSpace(sessionID) == "" {
		return "", fmt.Errorf("session id required")
	}
	rel := SessionDir(sessionID)
	abs := filepath.Join(workspace, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Join(abs, "attachments"), 0o755); err != nil {
		return "", err
	}
	return rel, nil
}

// WriteSessionAttachment saves bytes under attachments/ with a unique name.
func WriteSessionAttachment(workspace, sessionID, filename string, data []byte) (attachmentID, relPath string, err error) {
	if _, err = EnsureSessionDirs(workspace, sessionID); err != nil {
		return "", "", err
	}
	base := filepath.Base(strings.TrimSpace(filename))
	if base == "" || base == "." {
		base = "file-" + uuid.New().String()
	}
	attachmentID = base
	relPath = filepath.ToSlash(filepath.Join(SessionAttachmentsDir(sessionID), base))
	full := filepath.Join(workspace, filepath.FromSlash(relPath))
	if err := os.WriteFile(full, data, 0o644); err != nil {
		return "", "", err
	}
	return attachmentID, relPath, nil
}

// BuildSessionArchiveMarkdown renders a transcript for ingest pipeline input.
func BuildSessionArchiveMarkdown(sessionID, title string, messages []SessionArchiveMessage, archivedAt time.Time) string {
	var b strings.Builder
	b.WriteString("---\n")
	b.WriteString(fmt.Sprintf("session_id: %s\n", sessionID))
	if strings.TrimSpace(title) != "" {
		b.WriteString(fmt.Sprintf("title: %s\n", title))
	}
	b.WriteString(fmt.Sprintf("archived_at: %s\n", archivedAt.UTC().Format(time.RFC3339)))
	b.WriteString("source: web-ingest-session\n")
	b.WriteString("---\n\n")
	b.WriteString("# Ingest Session Archive\n\n")
	for _, m := range messages {
		role := m.Role
		if role == "user" {
			role = "User"
		} else if role == "assistant" {
			role = "Assistant"
		}
		if m.MessageType == "attachment_summary" {
			role = "Attachment"
		}
		b.WriteString(fmt.Sprintf("## %s\n\n%s\n\n", role, m.Content))
		if m.AttachmentPath != "" {
			b.WriteString(fmt.Sprintf("_attachment: `%s`_\n\n", m.AttachmentPath))
		}
	}
	return b.String()
}

type SessionArchiveMessage struct {
	Role           string
	Content        string
	MessageType    string
	AttachmentPath string
}

func NormalizeSessionArchive(sessionID, title, content, sourceRef string, now time.Time) (*NormalizedSource, error) {
	if strings.TrimSpace(content) == "" {
		return nil, fmt.Errorf("content is required")
	}
	name := fmt.Sprintf("archive-%s.md", now.Format("20060102-150405"))
	relPath := filepath.ToSlash(filepath.Join(SessionDir(sessionID), name))
	if strings.TrimSpace(sourceRef) == "" {
		sourceRef = "session_archive:" + sessionID
	}
	return &NormalizedSource{
		Kind:          InputKindSessionArchive,
		CanonicalPath: relPath,
		OriginalName:  name,
		SourceRef:     strings.TrimSpace(sourceRef),
		Content:       []byte(content),
	}, nil
}
