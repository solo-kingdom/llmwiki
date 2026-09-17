package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"sort"
	"strings"
	"sync"
	"time"
)

type rpcMessage struct {
	JSONRPC string          `json:"jsonrpc"`
	Method  string          `json:"method,omitempty"`
	ID      any             `json:"id,omitempty"`
	Params  json.RawMessage `json:"params,omitempty"`
	Result  json.RawMessage `json:"result,omitempty"`
	Error   *rpcError       `json:"error,omitempty"`
}

type rpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

type server struct {
	mu      sync.Mutex
	nextID  int64
	pending map[int64]chan rpcMessage

	cancelMu sync.Mutex
	cancel   chan struct{}
}

func main() {
	s := &server{pending: map[int64]chan rpcMessage{}, cancel: make(chan struct{})}
	scanner := bufio.NewScanner(os.Stdin)
	scanner.Buffer(make([]byte, 64*1024), 1024*1024)
	for scanner.Scan() {
		var msg rpcMessage
		if err := json.Unmarshal(scanner.Bytes(), &msg); err != nil {
			fmt.Fprintln(os.Stderr, "invalid json:", err)
			os.Exit(2)
		}
		if msg.Method == "" && msg.ID != nil {
			s.dispatchResponse(msg)
			continue
		}
		switch msg.Method {
		case "initialize":
			s.initialize(msg)
		case "session/new":
			s.write(rpcMessage{JSONRPC: "2.0", ID: msg.ID, Result: mustJSON(map[string]any{"sessionId": "remote-session"})})
		case "session/prompt":
			s.resetCancel()
			go s.handlePrompt(msg, s.cancel)
		case "session/cancel":
			s.cancelPrompt()
		default:
			s.write(rpcMessage{JSONRPC: "2.0", ID: msg.ID, Error: &rpcError{Code: -32601, Message: "Method not found"}})
		}
	}
}

func (s *server) initialize(msg rpcMessage) {
	version := 1
	if raw := os.Getenv("FAKE_ACP_PROTOCOL_VERSION"); raw != "" {
		_, _ = fmt.Sscanf(raw, "%d", &version)
	}
	result := map[string]any{
		"protocolVersion": version,
		"agentInfo": map[string]string{
			"name":    envOr("FAKE_ACP_AGENT_NAME", "fake-agent"),
			"version": envOr("FAKE_ACP_AGENT_VERSION", "1.2.3"),
		},
		"agentCapabilities": map[string]any{"loadSession": false},
	}
	s.write(rpcMessage{JSONRPC: "2.0", ID: msg.ID, Result: mustJSON(result)})
}

func (s *server) handlePrompt(msg rpcMessage, cancel <-chan struct{}) {
	behavior := envOr("FAKE_ACP_BEHAVIOR", "message")
	switch behavior {
	case "thought":
		s.update("agent_thought_chunk", "thinking...")
		s.update("agent_message_chunk", envOr("FAKE_ACP_MESSAGE", "hello"))
	case "tool":
		s.update("tool_call", map[string]any{
			"toolCallId": "tool-1", "title": "Read file", "kind": "read", "status": "in_progress",
			"rawInput": map[string]any{"path": "wiki/test.md"},
		})
		s.update("tool_call_update", map[string]any{"toolCallId": "tool-1", "status": "completed", "rawOutput": "ok"})
		s.update("agent_message_chunk", envOr("FAKE_ACP_MESSAGE", "tool complete"))
	case "thought_tool":
		s.update("agent_thought_chunk", "planning")
		s.update("tool_call", map[string]any{
			"toolCallId": "tool-1", "title": "Read file", "kind": "read", "status": "in_progress",
		})
		s.update("tool_call_update", map[string]any{"toolCallId": "tool-1", "status": "completed", "rawOutput": "ok"})
		s.update("agent_message_chunk", "done")
	case "permission":
		kind := envOr("FAKE_ACP_TOOL_KIND", "execute")
		result, err := s.call("session/request_permission", map[string]any{
			"sessionId": "remote-session",
			"toolCall":  map[string]any{"toolCallId": "perm-1", "title": "Run command", "kind": kind},
			"options": []map[string]string{
				{"optionId": "allow-1", "name": "Allow once", "kind": "allow_once"},
				{"optionId": "reject-1", "name": "Reject once", "kind": "reject_once"},
			},
		})
		text := "permission error"
		if err == nil {
			text = string(result)
		}
		s.update("agent_message_chunk", text)
	case "notify":
		s.notify("test/notify", map[string]string{"value": "seen"})
		s.update("agent_message_chunk", "notified")
	case "request":
		result, err := s.call("test/request", map[string]string{"value": "ping"})
		text := "request error"
		if err == nil {
			text = string(result)
		}
		s.update("agent_message_chunk", text)
	case "env":
		names := make([]string, 0)
		for _, item := range os.Environ() {
			name := item
			if i := strings.IndexByte(item, '='); i >= 0 {
				name = item[:i]
			}
			names = append(names, name)
		}
		sort.Strings(names)
		s.update("agent_message_chunk", strings.Join(names, ","))
	case "echo_prompt":
		var params struct {
			Prompt []struct {
				Text string `json:"text"`
			} `json:"prompt"`
		}
		_ = json.Unmarshal(msg.Params, &params)
		if len(params.Prompt) > 0 {
			s.update("agent_message_chunk", params.Prompt[0].Text)
		}
	case "hang":
		select {
		case <-cancel:
			s.writeResult(msg.ID, "cancelled")
			return
		case <-time.After(30 * time.Second):
			s.writeResult(msg.ID, "refusal")
			return
		}
	case "crash":
		fmt.Fprintln(os.Stderr, "fake agent crashed with sk-abcdefghijklmnop")
		os.Exit(7)
	case "crash_after_token":
		s.update("agent_message_chunk", "partial")
		fmt.Fprintln(os.Stderr, "fake agent crashed after token")
		os.Exit(7)
	case "crash_once":
		marker := os.Getenv("FAKE_ACP_CRASH_ONCE_FILE")
		if marker != "" {
			if _, err := os.Stat(marker); err != nil {
				_ = os.WriteFile(marker, []byte("crashed"), 0o600)
				fmt.Fprintln(os.Stderr, "fake agent first launch crash")
				os.Exit(7)
			}
		}
		s.update("agent_message_chunk", envOr("FAKE_ACP_MESSAGE", "recovered"))
	default:
		s.update("agent_message_chunk", envOr("FAKE_ACP_MESSAGE", "hello"))
	}
	s.writeResult(msg.ID, "end_turn")
}

func (s *server) update(kind string, value any) {
	var update map[string]any
	if text, ok := value.(string); ok {
		update = map[string]any{"sessionUpdate": kind, "content": map[string]any{"type": "text", "text": text}}
	} else {
		update = value.(map[string]any)
		update["sessionUpdate"] = kind
	}
	s.notify("session/update", map[string]any{"sessionId": "remote-session", "update": update})
}

func (s *server) call(method string, params any) (json.RawMessage, error) {
	s.mu.Lock()
	s.nextID++
	id := s.nextID
	ch := make(chan rpcMessage, 1)
	s.pending[id] = ch
	s.mu.Unlock()
	s.write(rpcMessage{JSONRPC: "2.0", ID: id, Method: method, Params: mustJSON(params)})
	select {
	case resp := <-ch:
		if resp.Error != nil {
			return nil, fmt.Errorf(resp.Error.Message)
		}
		return resp.Result, nil
	case <-time.After(5 * time.Second):
		s.mu.Lock()
		delete(s.pending, id)
		s.mu.Unlock()
		return nil, fmt.Errorf("request timeout")
	}
}

func (s *server) dispatchResponse(msg rpcMessage) {
	id := int64(0)
	switch v := msg.ID.(type) {
	case float64:
		id = int64(v)
	case int64:
		id = v
	}
	s.mu.Lock()
	ch := s.pending[id]
	delete(s.pending, id)
	s.mu.Unlock()
	if ch != nil {
		ch <- msg
	}
}

func (s *server) writeResult(id any, stopReason string) {
	s.write(rpcMessage{JSONRPC: "2.0", ID: id, Result: mustJSON(map[string]string{"stopReason": stopReason})})
}

func (s *server) notify(method string, params any) {
	s.write(rpcMessage{JSONRPC: "2.0", Method: method, Params: mustJSON(params)})
}

func (s *server) write(msg rpcMessage) {
	data, _ := json.Marshal(msg)
	s.mu.Lock()
	defer s.mu.Unlock()
	_, _ = os.Stdout.Write(append(data, '\n'))
}

func (s *server) resetCancel() {
	s.cancelMu.Lock()
	defer s.cancelMu.Unlock()
	s.cancel = make(chan struct{})
}

func (s *server) cancelPrompt() {
	s.cancelMu.Lock()
	defer s.cancelMu.Unlock()
	select {
	case <-s.cancel:
	default:
		close(s.cancel)
	}
}

func mustJSON(v any) json.RawMessage {
	data, _ := json.Marshal(v)
	return data
}

func envOr(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}
