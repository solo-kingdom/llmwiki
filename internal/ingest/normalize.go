package ingest

import (
	"fmt"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
)

const WebIngestBaseDir = "raw/sources/web-ingest"

type InputKind string

const (
	InputKindConversation InputKind = "conversation"
	InputKindText         InputKind = "text"
	InputKindUpload       InputKind = "upload"
)

type NormalizedSource struct {
	Kind          InputKind
	CanonicalPath string
	OriginalName  string
	SourceRef     string
	Content       []byte
}

func slug(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	if s == "" {
		return ""
	}
	var b strings.Builder
	lastDash := false
	for _, r := range s {
		switch {
		case (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9'):
			b.WriteRune(r)
			lastDash = false
		case r == '-' || r == '_' || r == ' ':
			if !lastDash {
				b.WriteByte('-')
				lastDash = true
			}
		}
	}
	return strings.Trim(b.String(), "-")
}

func canonicalPath(name string) string {
	name = strings.TrimSpace(filepath.Base(name))
	if name == "" || name == "." || name == "/" {
		name = "source-" + uuid.New().String() + ".txt"
	}
	return filepath.ToSlash(filepath.Join(WebIngestBaseDir, name))
}

func NormalizeConversation(title, content, sourceRef string, now time.Time) (*NormalizedSource, error) {
	if strings.TrimSpace(content) == "" {
		return nil, fmt.Errorf("content is required")
	}
	base := slug(title)
	if base == "" {
		base = "conversation"
	}
	name := fmt.Sprintf("%s-%s.md", base, now.Format("20060102-150405"))
	if strings.TrimSpace(sourceRef) == "" {
		sourceRef = string(InputKindConversation)
	}
	return &NormalizedSource{
		Kind:          InputKindConversation,
		CanonicalPath: canonicalPath(name),
		OriginalName:  name,
		SourceRef:     strings.TrimSpace(sourceRef),
		Content:       []byte(content),
	}, nil
}

func NormalizeText(title, filename, content, sourceRef string, now time.Time) (*NormalizedSource, error) {
	if strings.TrimSpace(content) == "" {
		return nil, fmt.Errorf("content is required")
	}
	name := strings.TrimSpace(filename)
	if name == "" {
		base := slug(title)
		if base == "" {
			base = "text"
		}
		name = fmt.Sprintf("%s-%s.md", base, now.Format("20060102-150405"))
	}
	if strings.TrimSpace(sourceRef) == "" {
		sourceRef = string(InputKindText)
	}
	return &NormalizedSource{
		Kind:          InputKindText,
		CanonicalPath: canonicalPath(name),
		OriginalName:  name,
		SourceRef:     strings.TrimSpace(sourceRef),
		Content:       []byte(content),
	}, nil
}

func NormalizeUpload(filename string, content []byte, sourceRef string) (*NormalizedSource, error) {
	name := strings.TrimSpace(filename)
	if name == "" {
		return nil, fmt.Errorf("filename is required")
	}
	if len(content) == 0 {
		return nil, fmt.Errorf("content is required")
	}
	if strings.TrimSpace(sourceRef) == "" {
		sourceRef = string(InputKindUpload)
	}
	return &NormalizedSource{
		Kind:          InputKindUpload,
		CanonicalPath: canonicalPath(name),
		OriginalName:  name,
		SourceRef:     strings.TrimSpace(sourceRef),
		Content:       content,
	}, nil
}
