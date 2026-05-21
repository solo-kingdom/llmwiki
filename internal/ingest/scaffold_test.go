package ingest

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestInitScaffoldRulesMD(t *testing.T) {
	dir := t.TempDir()
	if err := WriteWorkspaceScaffoldsIfMissing(dir); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(dir, "rules.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(data), "内容忠实性") {
		t.Fatalf("rules.md should contain Chinese fidelity section: %s", data)
	}
}
