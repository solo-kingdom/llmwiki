package acp

import (
	"context"
	"fmt"
	"sync"
	"time"
)

// Conn is one live ACP agent connection bound to an llmwiki session.
type Conn struct {
	*Client
	RemoteSessionID string
	AgentInfo       AgentInfo
	ProtocolVersion int
	StartedAt       time.Time
	HistoryReplayed bool
}

func (c *Conn) StderrTail() string {
	if c == nil || c.Client == nil || c.process == nil {
		return ""
	}
	return c.process.StderrTail()
}

type Manager struct {
	mu            sync.Mutex
	conns         map[string]*Conn
	maxConcurrent int
}

func NewManager(maxConcurrent int) *Manager {
	if maxConcurrent <= 0 {
		maxConcurrent = DefaultMaxConcurrentAgents
	}
	return &Manager{conns: map[string]*Conn{}, maxConcurrent: maxConcurrent}
}

func (m *Manager) Acquire(ctx context.Context, sessionID string, cfg AgentConfig, cwd string) (*Conn, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if existing := m.conns[sessionID]; existing != nil {
		return existing, nil
	}
	if len(m.conns) >= m.maxConcurrent {
		return nil, ErrTooManyAgents
	}
	applyAgentDefaults(&cfg)
	proc, err := spawn(ctx, cfg, cwd)
	if err != nil {
		return nil, err
	}
	client := newClient(proc, cfg)
	initCtx, cancel := context.WithTimeout(ctx, time.Duration(cfg.InitTimeoutMS)*time.Millisecond)
	defer cancel()
	init, err := client.Initialize(initCtx)
	if err != nil {
		_ = proc.Terminate()
		return nil, err
	}
	remoteSessionID, err := client.NewSession(initCtx, cwd)
	if err != nil {
		_ = proc.Terminate()
		return nil, fmt.Errorf("create ACP session: %w", err)
	}
	conn := &Conn{
		Client: client, RemoteSessionID: remoteSessionID, AgentInfo: init.AgentInfo,
		ProtocolVersion: init.ProtocolVersion, StartedAt: time.Now(),
	}
	m.conns[sessionID] = conn
	return conn, nil
}

// HasCapacity reports whether a session can acquire an agent now. It is used
// for an HTTP preflight so concurrency failures are returned before SSE starts.
func (m *Manager) HasCapacity(sessionID string) bool {
	if m == nil {
		return false
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.conns[sessionID]; ok {
		return true
	}
	return len(m.conns) < m.maxConcurrent
}

func (m *Manager) Invalidate(sessionID string) {
	m.mu.Lock()
	conn := m.conns[sessionID]
	delete(m.conns, sessionID)
	m.mu.Unlock()
	if conn != nil {
		_ = conn.process.Terminate()
	}
}

func (m *Manager) CloseSession(sessionID string) {
	if m == nil {
		return
	}
	m.Invalidate(sessionID)
}

func (m *Manager) CloseAll() {
	if m == nil {
		return
	}
	m.mu.Lock()
	conns := make([]*Conn, 0, len(m.conns))
	for _, conn := range m.conns {
		conns = append(conns, conn)
	}
	m.conns = map[string]*Conn{}
	m.mu.Unlock()
	for _, conn := range conns {
		_ = conn.process.Terminate()
	}
}

func applyAgentDefaults(cfg *AgentConfig) {
	if cfg.CWDPolicy == "" {
		cfg.CWDPolicy = DefaultCWDPolicy
	}
	if cfg.InitTimeoutMS == 0 {
		cfg.InitTimeoutMS = DefaultInitTimeoutMS
	}
	if cfg.PromptTimeoutMS == 0 {
		cfg.PromptTimeoutMS = DefaultPromptTimeoutMS
	}
	if cfg.IdleTimeoutMS == 0 {
		cfg.IdleTimeoutMS = DefaultIdleTimeoutMS
	}
	if cfg.EnvPassthrough == nil {
		cfg.EnvPassthrough = []string{"PATH", "HOME", "LANG"}
	}
}
