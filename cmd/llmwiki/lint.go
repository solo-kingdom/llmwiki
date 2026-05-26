package main

import (
	"encoding/json"
	"fmt"
	"os"

	"github.com/spf13/cobra"
	"github.com/solo-kingdom/llmwiki/internal/engine"
)

func newLintCmd() *cobra.Command {
	var jsonOut bool

	cmd := &cobra.Command{
		Use:   "lint [dir]",
		Short: "Check wiki content health (dead links, orphans, frontmatter)",
		Args:  cobra.MaximumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			dir := ""
			if len(args) > 0 {
				dir = args[0]
			}
			return runLint(dir, jsonOut)
		},
	}
	cmd.Flags().BoolVar(&jsonOut, "json", false, "Output LintReport as JSON")
	return cmd
}

func runLint(dir string, jsonOut bool) error {
	ws, err := resolveWorkspaceDir(dir)
	if err != nil {
		return err
	}

	report, err := engine.LintWorkspace(ws)
	if err != nil {
		return err
	}

	if jsonOut {
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		if err := enc.Encode(report); err != nil {
			return err
		}
	} else {
		printLintHuman(report)
	}

	if report.HasErrors() {
		n := 0
		for _, issue := range report.Issues {
			if issue.Severity == engine.LintSeverityError {
				n++
			}
		}
		return fmt.Errorf("lint: %d error(s) found", n)
	}
	return nil
}

func printLintHuman(report *engine.LintReport) {
	errors, warnings, infos := 0, 0, 0
	for _, issue := range report.Issues {
		switch issue.Severity {
		case engine.LintSeverityError:
			errors++
		case engine.LintSeverityWarning:
			warnings++
		case engine.LintSeverityInfo:
			infos++
		}
	}

	fmt.Printf("Wiki Lint — %d 错误, %d 警告, %d 信息\n", errors, warnings, infos)
	fmt.Printf("统计：%d 页, %d 源文件", report.Stats.PageCount, report.Stats.SourceCount)
	if report.Stats.LastUpdated != "" {
		fmt.Printf(", 最后更新 %s", report.Stats.LastUpdated)
	}
	fmt.Println()

	if len(report.Issues) == 0 {
		fmt.Println("未发现问题。")
		return
	}

	for _, issue := range report.Issues {
		loc := issue.Path
		if issue.Line > 0 {
			loc = fmt.Sprintf("%s:%d", issue.Path, issue.Line)
		}
		fmt.Printf("[%s] %s %s — %s\n", issue.Severity, issue.Code, loc, issue.Message)
	}
}
