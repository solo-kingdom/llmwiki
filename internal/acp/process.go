package acp

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"sync"
	"syscall"
	"time"
)

const stderrTailLimit = 4 * 1024

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
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}

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

func (p *process) Terminate() error {
	if p == nil || p.cmd == nil || p.cmd.Process == nil {
		return nil
	}
	p.terminateOnce.Do(func() {
		pgid := p.cmd.Process.Pid
		if err := syscall.Kill(-pgid, syscall.SIGTERM); err != nil && !errors.Is(err, syscall.ESRCH) {
			p.terminateErr = err
		}
		timer := time.NewTimer(3 * time.Second)
		defer timer.Stop()
		select {
		case <-p.waitDone:
		case <-timer.C:
			if err := syscall.Kill(-pgid, syscall.SIGKILL); err != nil && !errors.Is(err, syscall.ESRCH) {
				p.terminateErr = err
			}
			<-p.waitDone
		}
		_ = p.closeStdin()
	})
	return p.terminateErr
}
