package ingest

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// NormalizeJobSource reads the on-disk source for a job and returns normalized input.
func NormalizeJobSource(workspace string, inputType, sourcePath, sourceRef string) (*NormalizedSource, error) {
	full := filepath.Join(workspace, sourcePath)
	content, err := os.ReadFile(full)
	if err != nil {
		return nil, fmt.Errorf("read source: %w", err)
	}
	base := filepath.Base(sourcePath)
	switch strings.TrimSpace(inputType) {
	case string(InputKindConversation):
		return &NormalizedSource{
			Kind:          InputKindConversation,
			CanonicalPath: sourcePath,
			OriginalName:  base,
			SourceRef:     sourceRef,
			Content:       content,
		}, nil
	case string(InputKindText):
		return &NormalizedSource{
			Kind:          InputKindText,
			CanonicalPath: sourcePath,
			OriginalName:  base,
			SourceRef:     sourceRef,
			Content:       content,
		}, nil
	case string(InputKindSessionArchive), string(InputKindReviewPlan), string(InputKindReviewApply):
		return &NormalizedSource{
			Kind:          InputKindSessionArchive,
			CanonicalPath: sourcePath,
			OriginalName:  base,
			SourceRef:     sourceRef,
			Content:       content,
		}, nil
	default:
		return NormalizeUpload(base, content, sourceRef)
	}
}
