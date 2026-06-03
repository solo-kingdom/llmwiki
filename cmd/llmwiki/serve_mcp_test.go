package main

import (
	"strings"
	"testing"
)

// --- Task 1.1/1.4: Remote MCP security validation ---

func TestIsLoopback(t *testing.T) {
	tests := []struct {
		addr string
		want bool
	}{
		{"127.0.0.1", true},
		{"localhost", true},
		{"::1", true},
		{"0.0.0.0", false},
		{"192.168.1.1", false},
		{"10.0.0.1", false},
		{"", false},
	}

	for _, tt := range tests {
		t.Run(tt.addr, func(t *testing.T) {
			if got := isLoopback(tt.addr); got != tt.want {
				t.Errorf("isLoopback(%q) = %v, want %v", tt.addr, got, tt.want)
			}
		})
	}
}

// --- Task 3.1/3.2: mcp-config validation ---
// These tests use a helper that creates a valid workspace first.

func setupWorkspace(t *testing.T) string {
	t.Helper()
	ws := t.TempDir()
	if err := runInit(ws); err != nil {
		t.Fatalf("runInit: %v", err)
	}
	return ws
}

func TestMCPConfig_LocalDefaultNoToken(t *testing.T) {
	ws := setupWorkspace(t)
	// Local bind without token should succeed
	err := runMCPConfig(ws, "127.0.0.1", 8868, "")
	if err != nil {
		t.Fatalf("local mcp-config without token should succeed: %v", err)
	}
}

func TestMCPConfig_RemoteNoTokenRejected(t *testing.T) {
	ws := setupWorkspace(t)
	err := runMCPConfig(ws, "0.0.0.0", 8868, "")
	if err == nil {
		t.Fatal("remote mcp-config without token should be rejected")
	}
	if !strings.Contains(err.Error(), "--token") {
		t.Errorf("error should mention --token: %v", err)
	}
}

func TestMCPConfig_RemoteWithToken(t *testing.T) {
	ws := setupWorkspace(t)
	err := runMCPConfig(ws, "0.0.0.0", 8868, "my-secret")
	if err != nil {
		t.Fatalf("remote mcp-config with token should succeed: %v", err)
	}
}
