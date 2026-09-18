//go:build unix && !linux

package acp

import (
	"errors"
	"syscall"
	"time"
)

func processSysProcAttr() *syscall.SysProcAttr {
	// Setting the process group lets Terminate signal the whole agent tree
	// with a single negative-PGID kill on platforms without /proc.
	return &syscall.SysProcAttr{Setpgid: true}
}

// signalProcessGroup signals the process group led by pid. It is the primary
// cleanup mechanism on non-Linux Unix systems, preserving the existing
// process-group semantics there.
func signalProcessGroup(pid int, sig processSignal) error {
	err := syscall.Kill(-pid, syscall.Signal(sig.number()))
	if err != nil && !errors.Is(err, syscall.ESRCH) {
		return err
	}
	return nil
}

// processCleanup is a no-op on non-Linux Unix systems: the process-group
// signal above is the whole cleanup story.
type processCleanup struct{}

func newProcessCleanup(pid int) *processCleanup { return &processCleanup{} }

func (c *processCleanup) watch() {}

func (c *processCleanup) signal(pid int, sig processSignal) error { return nil }

func (c *processCleanup) wait(timeout time.Duration) {}

func (c *processCleanup) cleanup() {}

func (c *processCleanup) err() error { return nil }
