package ingest

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

func contentSHA256(content []byte) string {
	h := sha256.Sum256(content)
	return fmt.Sprintf("%x", h)
}

func cacheKeyForNormalized(source *NormalizedSource) string {
	if source == nil {
		return ""
	}
	return source.CanonicalPath + "|" + contentSHA256(source.Content)
}

func (p *Pipeline) loadCacheFile() (*cacheFile, error) {
	data, err := os.ReadFile(p.cachePath())
	if err != nil {
		if os.IsNotExist(err) {
			return &cacheFile{Entries: make(map[string]*CacheEntry)}, nil
		}
		return nil, err
	}

	var cf cacheFile
	if err := json.Unmarshal(data, &cf); err != nil {
		return nil, err
	}
	if cf.Entries == nil {
		cf.Entries = make(map[string]*CacheEntry)
	}
	return &cf, nil
}

func entryContentHash(entry *CacheEntry) string {
	if entry == nil {
		return ""
	}
	if entry.ContentSHA256 != "" {
		return entry.ContentSHA256
	}
	return entry.SHA256
}

func (p *Pipeline) lookupCache(key string, contentHash string, legacyKeys []string) (*CacheEntry, error) {
	cf, err := p.loadCacheFile()
	if err != nil {
		return nil, err
	}

	keys := append([]string{key}, legacyKeys...)
	for _, k := range keys {
		if k == "" {
			continue
		}
		entry, ok := cf.Entries[k]
		if !ok || entry == nil {
			continue
		}
		if entryContentHash(entry) != contentHash {
			continue
		}
		if !p.writtenFilesExist(entry.WrittenFiles) {
			continue
		}
		return entry, nil
	}

	return nil, fmt.Errorf("cache miss")
}

func (p *Pipeline) lookupCacheForSource(source *NormalizedSource, legacyKeys []string) (*CacheEntry, error) {
	if source == nil {
		return nil, fmt.Errorf("cache miss")
	}
	return p.lookupCache(cacheKeyForNormalized(source), contentSHA256(source.Content), legacyKeys)
}

func (p *Pipeline) saveCache(key string, entry *CacheEntry) error {
	if key == "" || entry == nil {
		return nil
	}

	dir := filepath.Join(p.workspace, ".llmwiki")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}

	cf, err := p.loadCacheFile()
	if err != nil {
		cf = &cacheFile{Entries: make(map[string]*CacheEntry)}
	}

	cf.Entries[key] = entry

	out, err := json.MarshalIndent(cf, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(p.cachePath(), out, 0o644)
}

func (p *Pipeline) saveCacheForSource(source *NormalizedSource, files []string) {
	if source == nil {
		return
	}
	hash := contentSHA256(source.Content)
	_ = p.saveCache(cacheKeyForNormalized(source), &CacheEntry{
		SourceName:    filepath.Base(source.CanonicalPath),
		SHA256:        hash,
		ContentSHA256: hash,
		WrittenFiles:  files,
	})
}

func (p *Pipeline) writtenFilesExist(files []string) bool {
	if len(files) == 0 {
		return false
	}
	for _, rel := range files {
		full := filepath.Join(p.workspace, rel)
		if _, err := os.Stat(full); err != nil {
			return false
		}
	}
	return true
}
