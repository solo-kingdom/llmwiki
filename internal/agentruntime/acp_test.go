package agentruntime

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/solo-kingdom/llmwiki/internal/acp"
	"github.com/solo-kingdom/llmwiki/internal/store/sqlite"
)

type acpTestSink struct {
	tokens      []string
	thoughts    []string
	tools       []string
	plans       []PlanEntry
	permissions []PermissionDecision
	warnings    []string
	debug       []string
}

func (s *acpTestSink) Token(text string)             { s.tokens = append(s.tokens, text) }
func (s *acpTestSink) Thought(text string)           { s.thoughts = append(s.thoughts, text) }
func (s *acpTestSink) ToolStart(name, detail string) { s.tools = append(s.tools, "start:"+name) }
func (s *acpTestSink) ToolDone(name, detail string)  { s.tools = append(s.tools, "done:"+name) }
func (s *acpTestSink) Plan(entries []PlanEntry)      { s.plans = append(s.plans, entries...) }
func (s *acpTestSink) Permission(decision PermissionDecision) {
	s.permissions = append(s.permissions, decision)
}
func (s *acpTestSink) Warning(code, message string) {
	s.warnings = append(s.warnings, code+":"+message)
}
func (s *acpTestSink) Debug(step, phase, message string, payload map[string]any) {
	s.debug = append(s.debug, phase)
}

func runtimeACPConfig(t *testing.T, behavior string) (acp.Config, acp.AgentConfig) {
	t.Helper()
	command := fakeRuntimeAgentPath(t)
	raw := `{"version":1,"agents":{"fake":{"id":"fake","name":"Fake","enabled":true,"command":"` + command + `","env_passthrough":["PATH","FAKE_ACP_BEHAVIOR","FAKE_ACP_MESSAGE","FAKE_ACP_CRASH_ONCE_FILE"],"permission":{"mode":"auto","allow_read":true,"allow_search":true}}},"defaults":{"readonly_only":true,"on_unavailable":"error"}}`
	cfg, err := acp.ParseConfig(raw)
	if err != nil {
		t.Fatalf("ParseConfig: %v", err)
	}
	agent := cfg.Agents["fake"]
	t.Setenv("FAKE_ACP_BEHAVIOR", behavior)
	return *cfg, agent
}

func TestACPRuntimeEvents(t *testing.T) {
	cfg, agent := runtimeACPConfig(t, "tool")
	mgr := acp.NewManager(2)
	t.Cleanup(mgr.CloseAll)
	runtime := newACPRuntime(mgr, t.TempDir(), cfg, agent)
	sink := &acpTestSink{}
	result, err := runtime.Prompt(context.Background(), PromptRequest{SessionID: "s1", UserContent: "hello"}, sink)
	if err != nil {
		t.Fatalf("Prompt: %v", err)
	}
	if result.StopReason != "end_turn" || strings.Join(sink.tokens, "") != "tool complete" {
		t.Fatalf("result=%+v tokens=%v", result, sink.tokens)
	}
	if strings.Join(sink.tools, ",") != "start:Read file,done:Read file" {
		t.Fatalf("tools = %v", sink.tools)
	}
}

func TestACPRuntimeEventOrder(t *testing.T) {
	cfg, agent := runtimeACPConfig(t, "thought_tool")
	mgr := acp.NewManager(2)
	t.Cleanup(mgr.CloseAll)
	runtime := newACPRuntime(mgr, t.TempDir(), cfg, agent)
	sink := &acpTestSink{}
	if _, err := runtime.Prompt(context.Background(), PromptRequest{SessionID: "s1", UserContent: "hello"}, sink); err != nil {
		t.Fatalf("Prompt: %v", err)
	}
	if strings.Join(sink.thoughts, "") != "planning" {
		t.Fatalf("thoughts = %v", sink.thoughts)
	}
	if strings.Join(sink.tools, ",") != "start:Read file,done:Read file" {
		t.Fatalf("tools = %v", sink.tools)
	}
	if strings.Join(sink.tokens, "") != "done" {
		t.Fatalf("tokens = %v", sink.tokens)
	}
}

func TestACPRuntimePermissionDenied(t *testing.T) {
	cfg, agent := runtimeACPConfig(t, "permission")
	mgr := acp.NewManager(2)
	t.Cleanup(mgr.CloseAll)
	runtime := newACPRuntime(mgr, t.TempDir(), cfg, agent)
	sink := &acpTestSink{}
	_, err := runtime.Prompt(context.Background(), PromptRequest{SessionID: "s1", UserContent: "run"}, sink)
	if err != nil {
		t.Fatalf("Prompt: %v", err)
	}
	if len(sink.permissions) != 1 || sink.permissions[0].Allowed || sink.permissions[0].Reason != "policy_denied" {
		t.Fatalf("permissions = %+v", sink.permissions)
	}
	if !strings.Contains(strings.Join(sink.tokens, ""), "reject-1") {
		t.Fatalf("agent did not receive reject option: %v", sink.tokens)
	}
}

func TestACPRuntimeCancel(t *testing.T) {
	cfg, agent := runtimeACPConfig(t, "hang")
	mgr := acp.NewManager(2)
	t.Cleanup(mgr.CloseAll)
	runtime := newACPRuntime(mgr, t.TempDir(), cfg, agent)
	ctx, cancel := context.WithCancel(context.Background())
	resultCh := make(chan PromptResult, 1)
	errCh := make(chan error, 1)
	go func() {
		result, err := runtime.Prompt(ctx, PromptRequest{SessionID: "s1", UserContent: "wait"}, &acpTestSink{})
		resultCh <- result
		errCh <- err
	}()
	time.Sleep(50 * time.Millisecond)
	cancel()
	result := <-resultCh
	if err := <-errCh; err != nil {
		t.Fatalf("Prompt error: %v", err)
	}
	if result.StopReason != "cancelled" {
		t.Fatalf("stop reason = %q, want cancelled", result.StopReason)
	}
}

func TestACPRuntimeRestartBeforeToken(t *testing.T) {
	cfg, agent := runtimeACPConfig(t, "crash_once")
	t.Setenv("FAKE_ACP_CRASH_ONCE_FILE", t.TempDir()+"/crashed")
	mgr := acp.NewManager(2)
	t.Cleanup(mgr.CloseAll)
	runtime := newACPRuntime(mgr, t.TempDir(), cfg, agent)
	sink := &acpTestSink{}
	result, err := runtime.Prompt(context.Background(), PromptRequest{SessionID: "s1", UserContent: "hello"}, sink)
	if err != nil {
		t.Fatalf("Prompt: %v", err)
	}
	if result.Text != "recovered" || strings.Join(sink.tokens, "") != "recovered" {
		t.Fatalf("restart result=%+v tokens=%v", result, sink.tokens)
	}
	found := false
	for _, phase := range sink.debug {
		if phase == "acp_process_restart" {
			found = true
		}
	}
	if !found {
		t.Fatalf("restart was not recorded: %v", sink.debug)
	}
}

func TestACPRuntimeDoesNotRestartAfterToken(t *testing.T) {
	cfg, agent := runtimeACPConfig(t, "crash_after_token")
	mgr := acp.NewManager(2)
	t.Cleanup(mgr.CloseAll)
	runtime := newACPRuntime(mgr, t.TempDir(), cfg, agent)
	sink := &acpTestSink{}
	result, err := runtime.Prompt(context.Background(), PromptRequest{SessionID: "s1", UserContent: "hello"}, sink)
	if err == nil {
		t.Fatal("expected crash error after token")
	}
	if result.Text != "partial" || strings.Join(sink.tokens, "") != "partial" {
		t.Fatalf("partial result=%+v tokens=%v", result, sink.tokens)
	}
}

func TestACPRuntimePromptTimeout(t *testing.T) {
	cfg, agent := runtimeACPConfig(t, "hang")
	agent.PromptTimeoutMS = 50
	mgr := acp.NewManager(2)
	t.Cleanup(mgr.CloseAll)
	runtime := newACPRuntime(mgr, t.TempDir(), cfg, agent)
	_, err := runtime.Prompt(context.Background(), PromptRequest{SessionID: "s1", UserContent: "wait"}, &acpTestSink{})
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("Prompt error = %v, want deadline exceeded", err)
	}
}

func TestACPRuntimeHistoryReplayAfterRestart(t *testing.T) {
	cfg, agent := runtimeACPConfig(t, "echo_prompt")
	mgr := acp.NewManager(2)
	t.Cleanup(mgr.CloseAll)
	runtime := newACPRuntime(mgr, t.TempDir(), cfg, agent)
	history := []sqlite.IngestSessionMessage{{Role: "user", Content: "old context", StreamStatus: "complete"}}
	firstSink := &acpTestSink{}
	if _, err := runtime.Prompt(context.Background(), PromptRequest{SessionID: "s1", UserContent: "first", History: history}, firstSink); err != nil {
		t.Fatalf("first Prompt: %v", err)
	}
	if !strings.Contains(strings.Join(firstSink.tokens, ""), "old context") {
		t.Fatalf("first prompt omitted history: %v", firstSink.tokens)
	}
	secondSink := &acpTestSink{}
	if _, err := runtime.Prompt(context.Background(), PromptRequest{SessionID: "s1", UserContent: "second", History: history}, secondSink); err != nil {
		t.Fatalf("second Prompt: %v", err)
	}
	if strings.Contains(strings.Join(secondSink.tokens, ""), "old context") {
		t.Fatalf("second prompt replayed history on same process: %v", secondSink.tokens)
	}
	mgr.Invalidate("s1")
	thirdSink := &acpTestSink{}
	if _, err := runtime.Prompt(context.Background(), PromptRequest{SessionID: "s1", UserContent: "third", History: history}, thirdSink); err != nil {
		t.Fatalf("third Prompt: %v", err)
	}
	if !strings.Contains(strings.Join(thirdSink.tokens, ""), "old context") {
		t.Fatalf("third prompt omitted history after restart: %v", thirdSink.tokens)
	}
}
