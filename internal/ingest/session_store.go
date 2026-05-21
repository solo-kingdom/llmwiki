package ingest

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
	"gopkg.in/yaml.v3"
)

const SessionBaseDir = "raw/sources/web-ingest/sessions"

var archiveFrontmatterRe = regexp.MustCompile(`(?s)^---\n(.*?)\n---`)

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

// SessionArchiveReference is one wiki page referenced during session chat.
type SessionArchiveReference struct {
	Path   string `yaml:"path" json:"path"`
	Title  string `yaml:"title" json:"title"`
	Source string `yaml:"source" json:"source"`
}

// SessionArchiveMessage is one row in a session archive transcript.
type SessionArchiveMessage struct {
	Role           string
	Content        string
	MessageType    string
	AttachmentPath string
}

// BuildSessionArchiveMarkdown renders a transcript for ingest pipeline input.
func BuildSessionArchiveMarkdown(sessionID, title string, messages []SessionArchiveMessage, refs []SessionArchiveReference, archivedAt time.Time) string {
	var b strings.Builder
	b.WriteString("---\n")
	b.WriteString(fmt.Sprintf("session_id: %s\n", sessionID))
	if strings.TrimSpace(title) != "" {
		b.WriteString(fmt.Sprintf("title: %s\n", title))
	}
	b.WriteString(fmt.Sprintf("archived_at: %s\n", archivedAt.UTC().Format(time.RFC3339)))
	b.WriteString("source: web-ingest-session\n")
	if len(refs) > 0 {
		data, _ := yaml.Marshal(map[string]interface{}{"referenced_wiki_pages": refs})
		trimmed := strings.TrimSpace(string(data))
		if trimmed != "" {
			b.WriteString(trimmed)
			b.WriteString("\n")
		}
	}
	b.WriteString("---\n\n")
	b.WriteString("# Ingest Session Archive\n\n")
	if len(refs) > 0 {
		b.WriteString("## Referenced Wiki Pages\n\n")
		for _, ref := range refs {
			label := ref.Title
			if label == "" {
				label = ref.Path
			}
			b.WriteString(fmt.Sprintf("- [[%s]] — %s (%s)\n", ref.Path, label, ref.Source))
		}
		b.WriteString("\n")
	}
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

// ParseReferencedWikiPagesFromArchive extracts referenced_wiki_pages from archive frontmatter.
func ParseReferencedWikiPagesFromArchive(content string) []SessionArchiveReference {
	match := archiveFrontmatterRe.FindStringSubmatch(content)
	if len(match) < 2 {
		return nil
	}
	var envelope struct {
		ReferencedWikiPages []SessionArchiveReference `yaml:"referenced_wiki_pages"`
	}
	if err := yaml.Unmarshal([]byte(match[1]), &envelope); err != nil {
		return nil
	}
	return envelope.ReferencedWikiPages
}

// FormatReferencedPagesForAnalysis renders analysis context for archived session references.
func FormatReferencedPagesForAnalysis(docLang string, refs []SessionArchiveReference) string {
	if len(refs) == 0 {
		return ""
	}
	var b strings.Builder
	if docLang == "en" {
		b.WriteString("Existing wiki pages referenced during the session (prefer update/merge over create when planning):\n")
	} else {
		b.WriteString("会话中引用的已有 wiki 页面（规划时优先 update/merge，而非盲目 create）：\n")
	}
	for _, ref := range refs {
		title := ref.Title
		if title == "" {
			title = ref.Path
		}
		b.WriteString(fmt.Sprintf("- %s — %s [%s]\n", ref.Path, title, ref.Source))
	}
	return b.String()
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
