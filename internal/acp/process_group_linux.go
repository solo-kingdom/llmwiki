//go:build linux

package acp

import (
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"golang.org/x/sys/unix"
)

func processSysProcAttr() *syscall.SysProcAttr {
	// Put the agent in its own process group so a negative-PGID signal still
	// reaches ordinary descendants even though Linux also walks /proc.
	return &syscall.SysProcAttr{Setpgid: true}
}

// signalProcessGroup signals the process group led by pid. On Linux this
// complements the /proc descendant walk: it catches group members that were
// forked between the walk and the signal.
func signalProcessGroup(pid int, sig processSignal) error {
	err := syscall.Kill(-pid, unixSignal(sig))
	if err != nil && !errors.Is(err, syscall.ESRCH) {
		return err
	}
	return nil
}

// pinnedDescendant is one detached-process-tree member pinned with a pidfd.
// A pidfd refers to a specific process instance, so PID reuse cannot redirect
// a later signal to an unrelated process.
type pinnedDescendant struct {
	pid       int
	startTime uint64
	fd        int // -1 while the process is believed gone
}

// processCleanup snapshots and signals the descendants of a single ACP agent
// root on Linux. It is deliberately stateless between calls except for the
// pin table: every signal call re-reads /proc while the root is still
// queryable, so children created at any point before the signal are included.
type processCleanup struct {
	mu   sync.Mutex
	pins map[int]*pinnedDescendant
	errs []error
}

func newProcessCleanup(pid int) *processCleanup {
	return &processCleanup{pins: map[int]*pinnedDescendant{}}
}

// watch is a no-op: snapshots are taken synchronously in signal, which keeps
// the window between observing a descendant and signalling it as small as
// possible and avoids a background goroutine per agent.
func (c *processCleanup) watch() {}

func (c *processCleanup) signal(pid int, sig processSignal) error {
	c.walk(pid)
	c.signalPinned(sig)
	return c.err()
}

// signalPinned sends sig to every pinned descendant that has not exited yet.
func (c *processCleanup) signalPinned(sig processSignal) {
	c.mu.Lock()
	pending := make([]*pinnedDescendant, 0, len(c.pins))
	for _, pin := range c.pins {
		if pin.fd >= 0 {
			pending = append(pending, pin)
		}
	}
	c.mu.Unlock()

	for _, pin := range pending {
		err := unix.PidfdSendSignal(pin.fd, unixSignal(sig), nil, 0)
		switch {
		case err == nil, errors.Is(err, unix.ESRCH):
			if errors.Is(err, unix.ESRCH) {
				c.markExited(pin)
			}
		default:
			// pidfd_send_signal can be blocked by old kernels or seccomp.
			// Fall back to a start-time-checked kill signal.
			if fallbackErr := killByStartTime(pin.pid, pin.startTime, sig); fallbackErr != nil {
				c.recordError(fallbackErr)
			}
		}
	}
}

func (c *processCleanup) wait(timeout time.Duration) {
	deadline := time.Now().Add(timeout)
	for {
		fds := c.liveFDs()
		if len(fds) == 0 {
			return
		}
		remaining := time.Until(deadline)
		if remaining <= 0 {
			return
		}
		pollTimeout := int(remaining / time.Millisecond)
		if pollTimeout < 0 {
			pollTimeout = 0
		}
		pollFds := make([]unix.PollFd, 0, len(fds))
		for _, fd := range fds {
			pollFds = append(pollFds, unix.PollFd{Fd: int32(fd), Events: unix.POLLIN})
		}
		_, _ = unix.Poll(pollFds, pollTimeout)
		for i, pollFd := range pollFds {
			if pollFd.Revents != 0 {
				c.markExitedByPID(fds[i])
			}
		}
	}
}

func (c *processCleanup) err() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if len(c.errs) == 0 {
		return nil
	}
	return c.errs[0]
}

func (c *processCleanup) recordError(err error) {
	if err == nil || errors.Is(err, errProcessGone) || errors.Is(err, unix.ESRCH) {
		return
	}
	c.mu.Lock()
	c.errs = append(c.errs, err)
	c.mu.Unlock()
}

// walk reads /proc/<pid>/task/<pid>/children recursively and pins every new
// descendant it finds. It is a best-effort snapshot: processes that exit or
// cannot be inspected are skipped, and "no such process" is never an error.
func (c *processCleanup) walk(pid int) {
	if _, err := procStartTime(pid); err != nil {
		return
	}
	seen := map[int]bool{pid: true}
	queue := []int{pid}
	for len(queue) > 0 {
		current := queue[0]
		queue = queue[1:]
		for _, child := range procChildren(current) {
			if seen[child] {
				continue
			}
			seen[child] = true
			queue = append(queue, child)
			c.pin(child)
		}
	}
}

func (c *processCleanup) pin(pid int) {
	childStart, err := procStartTime(pid)
	if err != nil {
		return
	}
	fd, err := unix.PidfdOpen(pid, 0)
	if err != nil {
		if errors.Is(err, unix.ESRCH) {
			return
		}
		// pidfds are unavailable (older kernel or seccomp). Record the
		// process anyway so signals can use the start-time-checked fallback.
		c.storePin(&pinnedDescendant{pid: pid, startTime: childStart, fd: -1})
		return
	}
	// The pidfd pins the process instance, so its identity is authoritative.
	// Re-read the start time to detect a PID reused between the first read and
	// pidfd_open; if the process is already gone, discard the fd.
	current, err := procStartTime(pid)
	if err != nil {
		_ = unix.Close(fd)
		return
	}
	c.storePin(&pinnedDescendant{pid: pid, startTime: current, fd: fd})
}

func (c *processCleanup) storePin(pin *pinnedDescendant) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if existing := c.pins[pin.pid]; existing != nil {
		if existing.startTime == pin.startTime && existing.fd >= 0 {
			if pin.fd >= 0 {
				_ = unix.Close(pin.fd)
			}
			return
		}
		if existing.fd >= 0 {
			_ = unix.Close(existing.fd)
		}
		c.pins[pin.pid] = pin
		return
	}
	c.pins[pin.pid] = pin
}

func (c *processCleanup) liveFDs() []int {
	c.mu.Lock()
	defer c.mu.Unlock()
	fds := make([]int, 0, len(c.pins))
	for _, pin := range c.pins {
		if pin.fd >= 0 {
			fds = append(fds, pin.fd)
		}
	}
	return fds
}

func (c *processCleanup) markExitedByPID(fd int) {
	c.mu.Lock()
	defer c.mu.Unlock()
	for _, pin := range c.pins {
		if pin.fd == fd {
			_ = unix.Close(pin.fd)
			pin.fd = -1
			return
		}
	}
}

func (c *processCleanup) markExited(pin *pinnedDescendant) {
	if pin == nil {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if pin.fd >= 0 {
		_ = unix.Close(pin.fd)
		pin.fd = -1
	}
}

// cleanup releases every pinned pidfd. Called once by the owner after the
// terminate sequence settles.
func (c *processCleanup) cleanup() {
	c.mu.Lock()
	defer c.mu.Unlock()
	for _, pin := range c.pins {
		if pin.fd >= 0 {
			_ = unix.Close(pin.fd)
			pin.fd = -1
		}
	}
}

// killByStartTime is the PID-reuse-safe fallback used when pidfd signalling is
// unavailable. It re-reads the start time immediately before killing and
// refuses to signal when the identity changed.
func killByStartTime(pid int, startTime uint64, sig processSignal) error {
	current, err := procStartTime(pid)
	if err != nil {
		return errProcessGone
	}
	if current != startTime {
		return errProcessGone
	}
	if err := syscall.Kill(pid, unixSignal(sig)); err != nil {
		if errors.Is(err, syscall.ESRCH) {
			return errProcessGone
		}
		return err
	}
	return nil
}

// procStartTime returns the process start time in clock ticks (field 22 of
// /proc/<pid>/stat). Together with the PID it unique-identifies a process
// instance against PID reuse.
func procStartTime(pid int) (uint64, error) {
	raw, err := os.ReadFile(fmt.Sprintf("/proc/%d/stat", pid))
	if err != nil {
		return 0, err
	}
	// The comm field is wrapped in parentheses and may itself contain spaces
	// and parentheses; fields after the last ')' are space separated and comm
	// is field 2, so field 22 is index 19 of that suffix.
	rest := string(raw)
	if idx := strings.LastIndexByte(rest, ')'); idx >= 0 {
		rest = rest[idx+1:]
	}
	fields := strings.Fields(rest)
	if len(fields) <= 19 {
		return 0, fmt.Errorf("short /proc/%d/stat", pid)
	}
	value, err := strconv.ParseUint(fields[19], 10, 64)
	if err != nil {
		return 0, fmt.Errorf("parse start time for pid %d: %w", pid, err)
	}
	return value, nil
}

// procChildren returns the direct children of pid according to
// /proc/<pid>/task/<pid>/children. Missing or unreadable entries yield no
// children rather than an error: the process may have exited or reparented.
func procChildren(pid int) []int {
	raw, err := os.ReadFile(fmt.Sprintf("/proc/%d/task/%d/children", pid, pid))
	if err != nil {
		return nil
	}
	fields := strings.Fields(string(raw))
	children := make([]int, 0, len(fields))
	for _, field := range fields {
		child, err := strconv.Atoi(field)
		if err != nil || child <= 0 {
			continue
		}
		children = append(children, child)
	}
	return children
}
