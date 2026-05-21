package engine

import "testing"

func TestValidateLogMD_valid(t *testing.T) {
	content := `---
title: 操作日志
---

# 操作日志

## [2024-01-01] init | 工作区初始化

## [2024-06-15] ingest | 导入文档
`
	issues := ValidateLogMD(content)
	if len(issues) != 0 {
		t.Fatalf("expected no issues, got %v", issues)
	}
}

func TestValidateLogMD_invalidFormat(t *testing.T) {
	content := `## [2024-01-01] missing pipe separator
`
	issues := ValidateLogMD(content)
	if len(issues) != 1 || issues[0].Code != LintCodeLogFormatInvalid {
		t.Fatalf("expected log_format_invalid, got %v", issues)
	}
}

func TestValidateLogMD_decreasingDate(t *testing.T) {
	content := `## [2024-06-01] a | first

## [2024-01-01] b | second
`
	issues := ValidateLogMD(content)
	found := false
	for _, i := range issues {
		if i.Code == LintCodeLogDateDecreasing {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected log_date_decreasing, got %v", issues)
	}
}
