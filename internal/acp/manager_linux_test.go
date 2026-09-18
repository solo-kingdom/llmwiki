//go:build linux

package acp

import (
	"context"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"
)

// TestManagerCloseSessionKillsDetachedDescendant reproduces the orphan found
// in the real cursor-agent ACP E2E: the agent launcher creates a worker that
// calls setsid, so it leaves the agent's process group and a negative-PGID
// signal cannot reach it. CloseSession must still clean it up via the /proc
// descendant walk.
func TestManagerCloseSessionKillsDetachedDescendant(t *testing.T) {
	dir := t.TempDir()
	pidFile := filepath.Join(dir, "detached.pid")
	cfg := fakeAgentConfig(t, "message", "FAKE_ACP_DETACH_CHILD", "FAKE_ACP_DETACH_CHILD_PIDFILE")
	t.Setenv("FAKE_ACP_DETACH_CHILD", "1")
	t.Setenv("FAKE_ACP_DETACH_CHILD_PIDFILE", pidFile)

	var (
		childPID       int
		childStartTime uint64
	)
	t.Cleanup(func() {
		if childPID != 0 && processMatchesStart(childPID, childStartTime) {
			_ = syscall.Kill(childPID, syscall.SIGKILL)
		}
	})

	mgr := NewManager(2)
	if _, err := mgr.Acquire(context.Background(), "s1", cfg, dir); err != nil {
		t.Fatalf("Acquire: %v", err)
	}
	defer mgr.CloseAll()

	childPID, childStartTime = readDetachedChild(t, pidFile)
	if !processMatchesStart(childPID, childStartTime) {
		t.Fatalf("detached child %d did not survive startup", childPID)
	}

	mgr.CloseSession("s1")
	waitForProcessExit(t, childPID, childStartTime)
	if processMatchesStart(childPID, childStartTime) {
		t.Fatalf("detached child %d is still alive after CloseSession", childPID)
	}
}

func readDetachedChild(t *testing.T, pidFile string) (int, uint64) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		data, err := os.ReadFile(pidFile)
		if err == nil {
			pid, convErr := strconv.Atoi(strings.TrimSpace(string(data)))
			if convErr == nil && pid > 0 {
				start, readErr := procStartTime(pid)
				if readErr == nil {
					return pid, start
				}
			}
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("detached child pid file %s was not written", pidFile)
	return 0, 0
}

func waitForProcessExit(t *testing.T, pid int, startTime uint64) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if !processMatchesStart(pid, startTime) {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
}

// processMatchesStart reports whether pid currently refers to the same process
// instance identified by startTime. This guards the test against PID reuse: a
// recycled PID has a different /proc start time.
func processMatchesStart(pid int, startTime uint64) bool {
	start, err := procStartTime(pid)
	if err != nil {
		return false
	}
	return start == startTime
}
