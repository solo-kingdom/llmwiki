package acp

import (
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"sync"
	"time"
)

const stderrTailLimit = 4 * 1024

// terminateGrace is how long Terminate waits after SIGTERM before escalating
// to SIGKILL. Tests override it via newTestProcess if needed; the value must
// stay below the 3s grace promised by the ACP lifecycle spec.
const terminateGrace = 3 * time.Second

type stderrRing struct {
	mu   sync.Mutex
	data []byte
}

func (r *stderrRing) Write(p []byte) (int, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.data = append(r.data, p...)
	if len(r.data) > stderrTailLimit {
		r.data = append([]byte(nil), r.data[len(r.data)-stderrTailLimit:]...)
	}
	return len(p), nil
}

func (r *stderrRing) String() string {
	r.mu.Lock()
	defer r.mu.Unlock()
	return SanitizeText(string(r.data))
}

type process struct {
	cmd           *exec.Cmd
	stdin         io.WriteCloser
	stdout        io.ReadCloser
	stderr        *stderrRing
	waitDone      chan struct{}
	waitOnce      sync.Once
	waitErr       error
	terminateOnce sync.Once
	terminateErr  error
	cleanup       *processCleanup
}

func spawn(ctx context.Context, cfg AgentConfig, cwd string) (*process, error) {
	if ctx != nil {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
	}
	path, err := exec.LookPath(cfg.Command)
	if err != nil {
		return nil, fmt.Errorf("%w: %s: %v", ErrCLINotFound, cfg.Command, err)
	}
	cmd := exec.Command(path, cfg.Args...)
	cmd.Dir = cwd
	cmd.Env = whitelistedEnv(cfg.EnvPassthrough)
	cmd.SysProcAttr = processSysProcAttr()

	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, fmt.Errorf("ACP stdin pipe: %w", err)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		_ = stdin.Close()
		return nil, fmt.Errorf("ACP stdout pipe: %w", err)
	}
	stderrPipe, err := cmd.StderrPipe()
	if err != nil {
		_ = stdin.Close()
		_ = stdout.Close()
		return nil, fmt.Errorf("ACP stderr pipe: %w", err)
	}
	if err := cmd.Start(); err != nil {
		_ = stdin.Close()
		_ = stdout.Close()
		_ = stderrPipe.Close()
		return nil, fmt.Errorf("start ACP agent: %w", err)
	}

	p := &process{
		cmd:      cmd,
		stdin:    stdin,
		stdout:   stdout,
		stderr:   &stderrRing{},
		waitDone: make(chan struct{}),
	}
	p.cleanup = newProcessCleanup(cmd.Process.Pid)
	go func() {
		_, _ = io.Copy(p.stderr, stderrPipe)
		_ = stderrPipe.Close()
	}()
	go func() { _ = p.wait() }()
	return p, nil
}

func whitelistedEnv(names []string) []string {
	seen := map[string]bool{}
	env := make([]string, 0, len(names)+1)
	if path, ok := os.LookupEnv("PATH"); ok {
		env = append(env, "PATH="+path)
		seen["PATH"] = true
	}
	for _, name := range names {
		if seen[name] {
			continue
		}
		value, ok := os.LookupEnv(name)
		if !ok {
			continue
		}
		env = append(env, name+"="+value)
		seen[name] = true
	}
	return env
}

func (p *process) write(data []byte) error {
	if p == nil || p.stdin == nil {
		return fmt.Errorf("ACP process stdin is unavailable")
	}
	_, err := p.stdin.Write(data)
	return err
}

func (p *process) closeStdin() error {
	if p == nil || p.stdin == nil {
		return nil
	}
	return p.stdin.Close()
}

func (p *process) wait() error {
	p.waitOnce.Do(func() {
		p.waitErr = p.cmd.Wait()
		close(p.waitDone)
	})
	<-p.waitDone
	return p.waitErr
}

func (p *process) StderrTail() string {
	if p == nil || p.stderr == nil {
		return ""
	}
	return p.stderr.String()
}

// Terminate stops the ACP agent and every process it started. It always runs
// two phases: SIGTERM first, then SIGKILL after terminateGrace.
//
// The root process is started in its own process group, so a negative-PGID
// signal reaches the direct agent and its ordinary descendants. Agents that
// detach children with setsid / double fork escape that group; the
// platform-specific cleanup snapshots those descendants while the parent
// tree is still queryable and signals them individually.
func (p *process) Terminate() error {
	if p == nil || p.cmd == nil || p.cmd.Process == nil {
		return nil
	}
	p.terminateOnce.Do(func() {
		p.terminateErr = p.terminate()
	})
	return p.terminateErr
}

func (p *process) terminate() error {
	pid := p.cmd.Process.Pid
	if p.cleanup != nil {
		p.cleanup.watch()
	}
	first := p.signalTargets(pid, signalTerm)
	groupErr := signalProcessGroup(pid, signalTerm)

	timer := time.NewTimer(terminateGrace)
	defer timer.Stop()
	select {
	case <-p.waitDone:
	case <-timer.C:
	}

	// Re-snapshot before the hard kill so agents that spawned detached
	// children during the grace window are still caught. Once the root is
	// gone its subtree is reparented and cannot be walked, so this is only
	// possible while the root remains queryable.
	second := p.signalTargets(pid, signalKill)
	groupErr2 := signalProcessGroup(pid, signalKill)

	_ = p.closeStdin()
	<-p.waitDone

	// Confirm the descendants we signalled are actually gone (pidfds, where
	// available, cannot be confused by PID reuse).
	if p.cleanup != nil {
		p.cleanup.wait(2 * time.Second)
		p.cleanup.cleanup()
	}
	return firstError(first, second, groupErr, groupErr2, p.terminateSignalError())
}

// signalTargets is implemented per platform. It returns the first unexpected
// error while signalling the known descendants of pid with sig.
func (p *process) signalTargets(pid int, sig processSignal) error {
	if p == nil || p.cleanup == nil {
		return nil
	}
	return p.cleanup.signal(pid, sig)
}

func (p *process) terminateSignalError() error {
	if p == nil || p.cleanup == nil {
		return nil
	}
	return p.cleanup.err()
}

func firstError(errs ...error) error {
	for _, err := range errs {
		if err != nil {
			return err
		}
	}
	return nil
}
