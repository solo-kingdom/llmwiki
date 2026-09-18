package acp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"
)

func buildFakeAgent(t *testing.T) string {
	t.Helper()
	out := filepath.Join(t.TempDir(), "fakeagent")
	cmd := exec.Command("go", "build", "-o", out, "./testdata/fakeagent")
	if data, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("build fake agent: %v\n%s", err, data)
	}
	return out
}

func startFakeConn(t *testing.T) *conn {
	t.Helper()
	cfg := AgentConfig{
		Command:        buildFakeAgent(t),
		EnvPassthrough: []string{"PATH", "FAKE_ACP_BEHAVIOR", "FAKE_ACP_MESSAGE", "FAKE_ACP_PROTOCOL_VERSION"},
	}
	proc, err := spawn(context.Background(), cfg, t.TempDir())
	if err != nil {
		t.Fatalf("spawn fake agent: %v", err)
	}
	c := newConn(proc)
	t.Cleanup(func() { _ = proc.Terminate() })
	return c
}

func TestJSONRPCRequestResponseAndNotification(t *testing.T) {
	t.Setenv("FAKE_ACP_BEHAVIOR", "notify")
	c := startFakeConn(t)

	var gotMethod string
	var gotParams json.RawMessage
	c.setNotificationHandler(func(method string, params json.RawMessage) {
		if method == "test/notify" {
			gotMethod = method
			gotParams = append(json.RawMessage(nil), params...)
		}
	})

	var init map[string]any
	if err := c.Call(context.Background(), "initialize", map[string]any{"protocolVersion": 1}, &init); err != nil {
		t.Fatalf("initialize: %v", err)
	}
	if init["protocolVersion"] != float64(1) {
		t.Fatalf("protocolVersion = %#v", init["protocolVersion"])
	}
	var session map[string]any
	if err := c.Call(context.Background(), "session/new", map[string]any{"cwd": t.TempDir(), "mcpServers": []any{}}, &session); err != nil {
		t.Fatalf("session/new: %v", err)
	}
	if session["sessionId"] != "remote-session" {
		t.Fatalf("sessionId = %#v", session["sessionId"])
	}
	var prompt map[string]string
	if err := c.Call(context.Background(), "session/prompt", map[string]any{"sessionId": "remote-session", "prompt": []any{map[string]string{"type": "text", "text": "hi"}}}, &prompt); err != nil {
		t.Fatalf("session/prompt: %v", err)
	}
	if gotMethod != "test/notify" || !strings.Contains(string(gotParams), "seen") {
		t.Fatalf("notification = %q %s", gotMethod, gotParams)
	}
}

func TestJSONRPCInboundRequest(t *testing.T) {
	t.Setenv("FAKE_ACP_BEHAVIOR", "request")
	c := startFakeConn(t)
	c.setRequestHandler(func(_ context.Context, method string, _ json.RawMessage) (any, error) {
		if method != "test/request" {
			return nil, errRPCMethodNotFound
		}
		return map[string]any{"ok": true}, nil
	})

	var text string
	c.setNotificationHandler(func(_ string, params json.RawMessage) {
		var envelope struct {
			Update struct {
				Content struct {
					Text string `json:"text"`
				} `json:"content"`
			} `json:"update"`
		}
		if json.Unmarshal(params, &envelope) == nil {
			text = envelope.Update.Content.Text
		}
	})
	if err := c.Call(context.Background(), "session/prompt", map[string]any{"sessionId": "remote-session"}, nil); err != nil {
		t.Fatalf("session/prompt: %v", err)
	}
	if !strings.Contains(text, `"ok":true`) {
		t.Fatalf("inbound request response not echoed: %q", text)
	}
}

func TestJSONRPCCallContextCancellation(t *testing.T) {
	t.Setenv("FAKE_ACP_BEHAVIOR", "hang")
	c := startFakeConn(t)
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	err := c.Call(ctx, "session/prompt", map[string]any{"sessionId": "remote-session"}, nil)
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("Call error = %v, want deadline exceeded", err)
	}
}

func TestJSONRPCStdoutEOFFailsPendingCall(t *testing.T) {
	t.Setenv("FAKE_ACP_BEHAVIOR", "crash")
	c := startFakeConn(t)
	err := c.Call(context.Background(), "session/prompt", map[string]any{"sessionId": "remote-session"}, nil)
	if err == nil {
		t.Fatal("expected crash error")
	}
	if !errors.Is(err, os.ErrProcessDone) && !errors.Is(err, context.Canceled) && !strings.Contains(err.Error(), "exit status") && err.Error() != "EOF" {
		t.Fatalf("unexpected pending call error: %v", err)
	}
}

func TestProcessWhitelistedEnvironment(t *testing.T) {
	t.Setenv("FAKE_ACP_BEHAVIOR", "env")
	t.Setenv("ACP_DECLARED_FOR_TEST", "visible")
	t.Setenv("ACP_UNDECLARED_FOR_TEST", "hidden")
	cfg := AgentConfig{
		Command:        buildFakeAgent(t),
		EnvPassthrough: []string{"PATH", "FAKE_ACP_BEHAVIOR", "ACP_DECLARED_FOR_TEST"},
	}
	proc, err := spawn(context.Background(), cfg, t.TempDir())
	if err != nil {
		t.Fatalf("spawn: %v", err)
	}
	c := newConn(proc)
	t.Cleanup(func() { _ = proc.Terminate() })
	var output string
	c.setNotificationHandler(func(_ string, params json.RawMessage) {
		var envelope struct {
			Update struct {
				Content struct {
					Text string `json:"text"`
				} `json:"content"`
			} `json:"update"`
		}
		if json.Unmarshal(params, &envelope) == nil && envelope.Update.Content.Text != "" {
			output = envelope.Update.Content.Text
		}
	})
	if err := c.Call(context.Background(), "session/prompt", map[string]any{"sessionId": "remote-session"}, nil); err != nil {
		t.Fatalf("session/prompt: %v", err)
	}
	if !strings.Contains(output, "FAKE_ACP_BEHAVIOR") || !strings.Contains(output, "ACP_DECLARED_FOR_TEST") || !strings.Contains(output, "PATH") {
		t.Fatalf("declared env missing: %s", output)
	}
	if strings.Contains(output, "ACP_UNDECLARED_FOR_TEST") {
		t.Fatalf("undeclared env leaked: %s", output)
	}
}

func TestProcessTerminateKillsProcessGroup(t *testing.T) {
	dir := t.TempDir()
	pidFile := filepath.Join(dir, "child.pid")
	cfg := AgentConfig{
		Command:        "/bin/sh",
		Args:           []string{"-c", "sleep 30 & echo $! > " + pidFile + "; wait"},
		EnvPassthrough: []string{"PATH"},
	}
	proc, err := spawn(context.Background(), cfg, dir)
	if err != nil {
		t.Fatalf("spawn process group: %v", err)
	}
	var childPID int
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		data, err := os.ReadFile(pidFile)
		if err == nil {
			_, _ = fmtSscanf(strings.TrimSpace(string(data)), &childPID)
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if childPID == 0 {
		_ = proc.Terminate()
		t.Fatal("child pid was not written")
	}
	if err := proc.Terminate(); err != nil {
		t.Fatalf("Terminate: %v", err)
	}
	time.Sleep(50 * time.Millisecond)
	if err := syscall.Kill(childPID, 0); !errors.Is(err, syscall.ESRCH) {
		t.Fatalf("child process %d still alive, kill(0) = %v", childPID, err)
	}
}

func fmtSscanf(s string, out *int) (int, error) {
	return fmtSscanfDirect(s, out)
}

func fmtSscanfDirect(s string, out *int) (int, error) {
	return fmt.Sscanf(s, "%d", out)
}
