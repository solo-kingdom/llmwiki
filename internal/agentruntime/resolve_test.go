package agentruntime

import (
	"errors"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/solo-kingdom/llmwiki/internal/acp"
	"github.com/solo-kingdom/llmwiki/internal/store/sqlite"
)

func fakeRuntimeAgentPath(t *testing.T) string {
	t.Helper()
	out := filepath.Join(t.TempDir(), "fakeagent")
	cmd := exec.Command("go", "build", "-o", out, "../acp/testdata/fakeagent")
	if data, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("build fake agent: %v\n%s", err, data)
	}
	return out
}

func seedRuntimeACPConfig(t *testing.T, db *sqlite.DB, agentJSON string) {
	t.Helper()
	if err := db.SetConfig("acp_agents_json", agentJSON); err != nil {
		t.Fatalf("SetConfig: %v", err)
	}
}

func TestResolveAgentKindsAndACPErrors(t *testing.T) {
	db := openRuntimeTestDB(t)
	command := fakeRuntimeAgentPath(t)
	valid := `{"version":1,"agents":{"fake":{"id":"fake","name":"Fake","enabled":true,"command":"` + command + `"}},"defaults":{"readonly_only":true,"on_unavailable":"error"}}`
	seedRuntimeACPConfig(t, db, valid)
	mgr := acp.NewManager(2)
	t.Cleanup(mgr.CloseAll)

	for _, kind := range []string{"", KindNative} {
		_, err := Resolve(db, t.TempDir(), mgr, &sqlite.IngestSession{AgentKind: kind})
		if !errors.Is(err, ErrNoProviderInstance) {
			t.Fatalf("kind %q error = %v, want native provider error", kind, err)
		}
	}
	_, err := Resolve(db, t.TempDir(), mgr, &sqlite.IngestSession{AgentKind: KindACP, ACPAgentID: "missing"})
	if !errors.Is(err, ErrNoACPAgent) {
		t.Fatalf("missing agent error = %v", err)
	}
	disabled := `{"version":1,"agents":{"fake":{"id":"fake","name":"Fake","enabled":false,"command":"` + command + `"}},"defaults":{"readonly_only":true,"on_unavailable":"error"}}`
	seedRuntimeACPConfig(t, db, disabled)
	_, err = Resolve(db, t.TempDir(), mgr, &sqlite.IngestSession{AgentKind: KindACP, ACPAgentID: "fake"})
	if !errors.Is(err, ErrACPAgentDisabled) {
		t.Fatalf("disabled agent error = %v", err)
	}
	invalid := `{"version":1,"agents":{"fake":{"id":"fake","name":"Fake","enabled":true,"command":"definitely-missing-runtime-cli"}},"defaults":{"readonly_only":true,"on_unavailable":"error"}}`
	seedRuntimeACPConfig(t, db, invalid)
	_, err = Resolve(db, t.TempDir(), mgr, &sqlite.IngestSession{AgentKind: KindACP, ACPAgentID: "fake"})
	if !errors.Is(err, ErrACPCLINotFound) {
		t.Fatalf("missing CLI error = %v", err)
	}
	seedRuntimeACPConfig(t, db, "{")
	_, err = Resolve(db, t.TempDir(), mgr, &sqlite.IngestSession{AgentKind: KindACP, ACPAgentID: "fake"})
	if !errors.Is(err, ErrACPConfigInvalid) {
		t.Fatalf("invalid config error = %v", err)
	}
}
