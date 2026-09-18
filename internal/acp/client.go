package acp

import (
	"context"
	"encoding/json"
	"fmt"
	"path/filepath"
	"sync"
	"time"
)

// Version is the llmwiki client version advertised to ACP agents. cmd/llmwiki
// assigns its ldflags-injected version before serving.
var Version = "dev"

type ClientInfo struct {
	Name    string `json:"name"`
	Title   string `json:"title"`
	Version string `json:"version"`
}

type AgentInfo struct {
	Name    string `json:"name"`
	Version string `json:"version"`
}

type InitializeResult struct {
	ProtocolVersion   int            `json:"protocolVersion"`
	AgentCapabilities map[string]any `json:"agentCapabilities"`
	AgentInfo         AgentInfo      `json:"agentInfo"`
	AuthMethods       []any          `json:"authMethods"`
}

type Handlers struct {
	OnEvent      func(Event)
	OnPermission func(PermissionRequest) PermissionDecision
}

type promptOutcome struct {
	stopReason string
	err        error
}

type activePrompt struct {
	activity chan struct{}
	handlers Handlers

	mu        sync.Mutex
	cancelled bool
	outcome   chan promptOutcome
}

func (p *activePrompt) markCancelled() {
	p.mu.Lock()
	p.cancelled = true
	p.mu.Unlock()
}

func (p *activePrompt) isCancelled() bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.cancelled
}

// Client implements the ACP v1 client side over one stdio connection.
type Client struct {
	conn    *conn
	process *process
	cfg     AgentConfig

	mu     sync.Mutex
	active map[string]*activePrompt
}

func newClient(proc *process, cfg AgentConfig) *Client {
	c := &Client{conn: newConn(proc), process: proc, cfg: cfg, active: map[string]*activePrompt{}}
	c.conn.setNotificationHandler(c.handleNotification)
	c.conn.setRequestHandler(c.handleRequest)
	return c
}

func (c *Client) Initialize(ctx context.Context) (InitializeResult, error) {
	params := map[string]any{
		"protocolVersion": 1,
		"clientCapabilities": map[string]any{
			"fs":       map[string]bool{"readTextFile": false, "writeTextFile": false},
			"terminal": false,
		},
		"clientInfo": ClientInfo{Name: "llmwiki", Title: "LLM Wiki", Version: Version},
	}
	var result InitializeResult
	if err := c.conn.Call(ctx, "initialize", params, &result); err != nil {
		return InitializeResult{}, err
	}
	if result.ProtocolVersion != 1 {
		return result, fmt.Errorf("%w: agent requested protocolVersion=%d, llmwiki supports 1", ErrProtocolVersionUnsupported, result.ProtocolVersion)
	}
	return result, nil
}

func (c *Client) NewSession(ctx context.Context, cwd string) (string, error) {
	absolute, err := filepath.Abs(cwd)
	if err != nil {
		return "", fmt.Errorf("resolve ACP session cwd: %w", err)
	}
	var result struct {
		SessionID string `json:"sessionId"`
	}
	if err := c.conn.Call(ctx, "session/new", map[string]any{"cwd": absolute, "mcpServers": []any{}}, &result); err != nil {
		return "", err
	}
	if result.SessionID == "" {
		return "", fmt.Errorf("ACP session/new returned empty sessionId")
	}
	return result.SessionID, nil
}

func (c *Client) Prompt(ctx context.Context, sessionID, text string, handlers Handlers) (string, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	active := &activePrompt{activity: make(chan struct{}, 1), handlers: handlers, outcome: make(chan promptOutcome, 1)}
	c.mu.Lock()
	c.active[sessionID] = active
	c.mu.Unlock()
	defer func() {
		c.mu.Lock()
		if c.active[sessionID] == active {
			delete(c.active, sessionID)
		}
		c.mu.Unlock()
	}()

	callResult := make(chan promptOutcome, 1)
	go func() {
		var result struct {
			StopReason string `json:"stopReason"`
		}
		err := c.conn.Call(context.Background(), "session/prompt", map[string]any{
			"sessionId": sessionID,
			"prompt":    []map[string]string{{"type": "text", "text": text}},
		}, &result)
		if err != nil {
			tail := c.process.StderrTail()
			if tail != "" {
				err = fmt.Errorf("%w: %s", err, tail)
			}
		}
		outcome := promptOutcome{stopReason: result.StopReason, err: err}
		select {
		case active.outcome <- outcome:
		default:
		}
		callResult <- outcome
	}()

	idle := time.NewTimer(time.Duration(c.cfg.IdleTimeoutMS) * time.Millisecond)
	defer idle.Stop()
	for {
		select {
		case outcome := <-callResult:
			return outcome.stopReason, outcome.err
		case <-active.activity:
			if !idle.Stop() {
				select {
				case <-idle.C:
				default:
				}
			}
			idle.Reset(time.Duration(c.cfg.IdleTimeoutMS) * time.Millisecond)
		case <-idle.C:
			active.markCancelled()
			if err := c.Cancel(sessionID); err != nil {
				return "", err
			}
			outcome := <-callResult
			return outcome.stopReason, outcome.err
		case <-ctx.Done():
			active.markCancelled()
			if err := c.Cancel(sessionID); err != nil {
				return "", err
			}
			outcome := <-callResult
			return outcome.stopReason, outcome.err
		}
	}
}

func (c *Client) Cancel(sessionID string) error {
	c.mu.Lock()
	active := c.active[sessionID]
	c.mu.Unlock()
	notifyErr := c.conn.Notify("session/cancel", map[string]any{"sessionId": sessionID})
	if active == nil {
		return notifyErr
	}
	timer := time.NewTimer(5 * time.Second)
	defer timer.Stop()
	select {
	case <-active.outcome:
		return notifyErr
	case <-timer.C:
		return ErrCancelTimeout
	}
}

func (c *Client) Close() error {
	_ = c.process.closeStdin()
	timer := time.NewTimer(2 * time.Second)
	defer timer.Stop()
	select {
	case <-c.process.waitDone:
		return nil
	case <-timer.C:
		return c.process.Terminate()
	}
}

func (c *Client) handleNotification(method string, params json.RawMessage) {
	if method != "session/update" {
		return
	}
	sessionID := sessionIDFromParams(params)
	c.mu.Lock()
	active := c.active[sessionID]
	c.mu.Unlock()
	if active == nil {
		return
	}
	select {
	case active.activity <- struct{}{}:
	default:
	}
	event, err := DecodeSessionUpdate(params)
	if err != nil {
		return
	}
	if active.handlers.OnEvent != nil {
		active.handlers.OnEvent(event)
	}
}

func (c *Client) handleRequest(_ context.Context, method string, params json.RawMessage) (any, error) {
	if method != "session/request_permission" {
		return nil, errRPCMethodNotFound
	}
	var req PermissionRequest
	if err := json.Unmarshal(params, &req); err != nil {
		return nil, fmt.Errorf("decode permission request: %w", err)
	}
	c.mu.Lock()
	active := c.active[req.SessionID]
	c.mu.Unlock()
	decision := CancelledDecision(req)
	if active == nil || !active.isCancelled() {
		handler := Handlers{}
		if active != nil {
			handler = active.handlers
		}
		if handler.OnPermission != nil {
			decision = handler.OnPermission(req)
		}
	}
	return permissionResponse(decision), nil
}

func sessionIDFromParams(params json.RawMessage) string {
	var envelope struct {
		SessionID string `json:"sessionId"`
	}
	_ = json.Unmarshal(params, &envelope)
	return envelope.SessionID
}

func permissionResponse(decision PermissionDecision) map[string]any {
	if decision.Outcome == "selected" && decision.OptionID != "" {
		return map[string]any{"outcome": map[string]string{"outcome": "selected", "optionId": decision.OptionID}}
	}
	return map[string]any{"outcome": map[string]string{"outcome": "cancelled"}}
}
