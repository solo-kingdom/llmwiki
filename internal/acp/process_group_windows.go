//go:build windows

package acp

import (
	"os"
	"syscall"
	"time"
)

func processSysProcAttr() *syscall.SysProcAttr { return &syscall.SysProcAttr{} }

// signalProcessGroup has no process-group equivalent here; the root process is
// stopped directly and any deeper cleanup stays with the agent.
func signalProcessGroup(pid int, sig processSignal) error {
	if sig != signalKill {
		// Windows has no SIGTERM; defer to the shared hard-kill phase.
		return nil
	}
	if pid <= 0 {
		return nil
	}
	proc, err := os.FindProcess(pid)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	if err := proc.Kill(); err != nil && !os.IsNotExist(err) {
		return nil
	}
	return nil
}

// processCleanup is a no-op on Windows; process groups are not used.
type processCleanup struct{}

func newProcessCleanup(pid int) *processCleanup { return &processCleanup{} }

func (c *processCleanup) watch() {}

func (c *processCleanup) signal(pid int, sig processSignal) error { return nil }

func (c *processCleanup) wait(timeout time.Duration) {}

func (c *processCleanup) cleanup() {}

func (c *processCleanup) err() error { return nil }
