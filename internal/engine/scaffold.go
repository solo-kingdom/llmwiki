package engine

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// WorkspaceDirs lists all directories created during workspace initialization.
var WorkspaceDirs = []string{
	"wiki",
	"wiki/templates",
	"wiki/entities",
	"wiki/concepts",
	"wiki/sources",
	"wiki/synthesis",
	"wiki/comparisons",
	"wiki/queries",
	"raw/sources",
	"raw/assets",
	"revert",
	".llmwiki",
	".llmwiki/cache",
	".obsidian",
}

// workspaceLeafDirs are directories that receive a .gitkeep when empty.
var workspaceLeafDirs = []string{
	"wiki/entities",
	"wiki/concepts",
	"wiki/sources",
	"wiki/synthesis",
	"wiki/comparisons",
	"wiki/queries",
	"raw/sources",
	"raw/assets",
}

const obsidianAppJSON = `{
  "promptDelete": false,
  "showLineNumber": true,
  "strictLineBreaks": false,
  "showFrontmatter": true,
  "useMarkdownLinks": false
}
`

const purposeScaffoldMD = `---
title: 研究目标
goals: []
key_questions: []
scope: ""
---

# 研究目标

请在此描述你的研究目标、关键问题与范围。

## 目标

- （待填写）

## 关键问题

- （待填写）

## 范围

（待填写）
`

const overviewScaffoldMD = `---
title: 全局总览
description: 知识库全局总览（自动维护）
---

# 全局总览

## 项目目标

（待填写）

## 当前状态

（待填写）

## 主要主题

（待填写）
`

// LogScaffoldMD returns wiki/log.md content with an init entry for the given date.
func LogScaffoldMD(initDate string) string {
	return fmt.Sprintf(`---
title: 操作日志
---

# 操作日志

## [%s] init | 工作区初始化
`, initDate)
}

// IndexScaffoldMD returns an empty wiki/index.md framework grouped by subdirectory.
func IndexScaffoldMD(date string) string {
	b := &IndexBuilder{}
	return b.buildIndexContent(date, nil)
}

// WriteIfNotExists writes content to path only when the file does not exist.
func WriteIfNotExists(path, content string) error {
	if _, err := os.Stat(path); err == nil {
		return nil
	} else if !os.IsNotExist(err) {
		return fmt.Errorf("stat %s: %w", path, err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		return fmt.Errorf("write %s: %w", path, err)
	}
	return nil
}

// EnsureWorkspaceStructure creates required directories and .gitkeep placeholders.
func EnsureWorkspaceStructure(workspace string) error {
	for _, d := range WorkspaceDirs {
		if err := os.MkdirAll(filepath.Join(workspace, d), 0o755); err != nil {
			return fmt.Errorf("create %s: %w", d, err)
		}
	}
	for _, d := range workspaceLeafDirs {
		if err := WriteIfNotExists(filepath.Join(workspace, d, ".gitkeep"), ""); err != nil {
			return err
		}
	}
	return nil
}

// WriteWorkspaceScaffoldsIfMissing writes Chinese scaffold files and Obsidian config.
func WriteWorkspaceScaffoldsIfMissing(workspace, initDate string) error {
	if initDate == "" {
		initDate = time.Now().Format("2006-01-02")
	}

	scaffolds := map[string]string{
		"purpose.md":      purposeScaffoldMD,
		"wiki/overview.md": overviewScaffoldMD,
		"wiki/log.md":     LogScaffoldMD(initDate),
		"wiki/index.md":   IndexScaffoldMD(initDate),
	}
	for rel, content := range scaffolds {
		if err := WriteIfNotExists(filepath.Join(workspace, rel), content); err != nil {
			return err
		}
	}
	for rel, content := range WikiPageTemplateFiles() {
		if err := WriteIfNotExists(filepath.Join(workspace, rel), content); err != nil {
			return err
		}
	}

	obsidianPath := filepath.Join(workspace, ".obsidian", "app.json")
	if err := WriteIfNotExists(obsidianPath, strings.TrimSpace(obsidianAppJSON)+"\n"); err != nil {
		return err
	}
	return nil
}
