package acp

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"
)

func startFakeClient(t *testing.T, behavior string, idleMS int) *Client {
	t.Helper()
	t.Setenv("FAKE_ACP_BEHAVIOR", behavior)
	cfg := AgentConfig{
		Command:        buildFakeAgent(t),
		EnvPassthrough: []string{"PATH", "FAKE_ACP_BEHAVIOR", "FAKE_ACP_PROTOCOL_VERSION", "FAKE_ACP_MESSAGE"},
		IdleTimeoutMS:  idleMS,
	}
	proc, err := spawn(context.Background(), cfg, t.TempDir())
	if err != nil {
		t.Fatalf("spawn: %v", err)
	}
	client := newClient(proc, cfg)
	t.Cleanup(func() { _ = proc.Terminate() })
	return client
}

func TestClientInitializeNewSessionNormalPrompt(t *testing.T) {
	client := startFakeClient(t, "message", 5000)
	init, err := client.Initialize(context.Background())
	if err != nil {
		t.Fatalf("Initialize: %v", err)
	}
	if init.ProtocolVersion != 1 || init.AgentInfo.Name != "fake-agent" {
		t.Fatalf("unexpected initialize result: %+v", init)
	}
	sessionID, err := client.NewSession(context.Background(), t.TempDir())
	if err != nil {
		t.Fatalf("NewSession: %v", err)
	}
	var text string
	stop, err := client.Prompt(context.Background(), sessionID, "hi", Handlers{
		OnEvent: func(event Event) {
			if event.Kind == "message" {
				text += event.Text
			}
		},
	})
	if err != nil {
		t.Fatalf("Prompt: %v", err)
	}
	if stop != "end_turn" || text != "hello" {
		t.Fatalf("prompt = (%q, %q), want (end_turn, hello)", stop, text)
	}
}

func TestClientRejectsProtocolVersion(t *testing.T) {
	t.Setenv("FAKE_ACP_PROTOCOL_VERSION", "2")
	client := startFakeClient(t, "message", 5000)
	_, err := client.Initialize(context.Background())
	if !errors.Is(err, ErrProtocolVersionUnsupported) || !strings.Contains(err.Error(), "2") {
		t.Fatalf("Initialize error = %v", err)
	}
}

func TestClientThoughtAndMessageEvents(t *testing.T) {
	client := startFakeClient(t, "thought", 5000)
	if _, err := client.Initialize(context.Background()); err != nil {
		t.Fatalf("Initialize: %v", err)
	}
	var kinds []string
	var text string
	if _, err := client.Prompt(context.Background(), "remote-session", "hi", Handlers{OnEvent: func(event Event) {
		kinds = append(kinds, event.Kind)
		if event.Kind == "message" {
			text = event.Text
		}
	}}); err != nil {
		t.Fatalf("Prompt: %v", err)
	}
	if strings.Join(kinds, ",") != "thought,message" || text != "hello" {
		t.Fatalf("kinds=%v text=%q", kinds, text)
	}
}

func TestClientToolEventOrder(t *testing.T) {
	client := startFakeClient(t, "tool", 5000)
	if _, err := client.Initialize(context.Background()); err != nil {
		t.Fatalf("Initialize: %v", err)
	}
	var kinds []string
	if _, err := client.Prompt(context.Background(), "remote-session", "hi", Handlers{OnEvent: func(event Event) {
		kinds = append(kinds, event.Kind)
	}}); err != nil {
		t.Fatalf("Prompt: %v", err)
	}
	if strings.Join(kinds, ",") != "tool_call,tool_call_update,message" {
		t.Fatalf("event order = %v", kinds)
	}
}

func TestClientPermissionDecision(t *testing.T) {
	client := startFakeClient(t, "permission", 5000)
	t.Setenv("FAKE_ACP_TOOL_KIND", "execute")
	if _, err := client.Initialize(context.Background()); err != nil {
		t.Fatalf("Initialize: %v", err)
	}
	var text string
	if _, err := client.Prompt(context.Background(), "remote-session", "hi", Handlers{
		OnPermission: func(req PermissionRequest) PermissionDecision {
			return Decide(PermissionPolicy{}, true, req)
		},
		OnEvent: func(event Event) {
			if event.Kind == "message" {
				text = event.Text
			}
		},
	}); err != nil {
		t.Fatalf("Prompt: %v", err)
	}
	if !strings.Contains(text, "reject-1") {
		t.Fatalf("permission response not echoed: %q", text)
	}
}

func TestClientIdleTimeoutCancels(t *testing.T) {
	client := startFakeClient(t, "hang", 50)
	if _, err := client.Initialize(context.Background()); err != nil {
		t.Fatalf("Initialize: %v", err)
	}
	stop, err := client.Prompt(context.Background(), "remote-session", "hi", Handlers{})
	if err != nil {
		t.Fatalf("Prompt: %v", err)
	}
	if stop != "cancelled" {
		t.Fatalf("stopReason = %q, want cancelled", stop)
	}
}

func TestClientCancel(t *testing.T) {
	client := startFakeClient(t, "hang", 5000)
	if _, err := client.Initialize(context.Background()); err != nil {
		t.Fatalf("Initialize: %v", err)
	}
	result := make(chan string, 1)
	errCh := make(chan error, 1)
	go func() {
		stop, err := client.Prompt(context.Background(), "remote-session", "hi", Handlers{})
		result <- stop
		errCh <- err
	}()
	time.Sleep(50 * time.Millisecond)
	if err := client.Cancel("remote-session"); err != nil {
		t.Fatalf("Cancel: %v", err)
	}
	if stop := <-result; stop != "cancelled" {
		t.Fatalf("stopReason = %q, want cancelled", stop)
	}
	if err := <-errCh; err != nil {
		t.Fatalf("Prompt error: %v", err)
	}
}

func TestClientCrashIncludesSanitizedStderr(t *testing.T) {
	client := startFakeClient(t, "crash", 5000)
	if _, err := client.Initialize(context.Background()); err != nil {
		t.Fatalf("Initialize: %v", err)
	}
	_, err := client.Prompt(context.Background(), "remote-session", "hi", Handlers{})
	if err == nil {
		t.Fatal("expected crash error")
	}
	if strings.Contains(err.Error(), "sk-abcdefghijklmnop") || !strings.Contains(err.Error(), "***") {
		t.Fatalf("stderr not sanitized: %v", err)
	}
}
