package mcp

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync/atomic"
	"time"
)

// Transport performs MCP JSON-RPC over a specific wire protocol.
type Transport interface {
	ListTools(ctx context.Context) ([]Tool, error)
	CallTool(ctx context.Context, name string, args map[string]interface{}) (string, error)
	Close() error
}

// NewTransport creates a transport for the given server config.
func NewTransport(server ServerConfig) (Transport, error) {
	switch server.Transport {
	case "sse":
		return newSSETransport(server)
	case "streamable-http":
		return newStreamableHTTPTransport(server)
	case "stdio":
		return &stdioTransport{server: server}, nil
	default:
		return nil, fmt.Errorf("unsupported transport %q", server.Transport)
	}
}

// --- streamable-http ---

type streamableHTTPTransport struct {
	server ServerConfig
	client *http.Client
}

func newStreamableHTTPTransport(server ServerConfig) (*streamableHTTPTransport, error) {
	timeout := time.Duration(server.TimeoutMS) * time.Millisecond
	if timeout <= 0 {
		timeout = DefaultTimeoutMS * time.Millisecond
	}
	return &streamableHTTPTransport{
		server: server,
		client: &http.Client{Timeout: timeout},
	}, nil
}

func (t *streamableHTTPTransport) ListTools(ctx context.Context) ([]Tool, error) {
	res, err := t.rpc(ctx, "tools/list", nil)
	if err != nil {
		return nil, err
	}
	return parseToolsListResult(res)
}

func (t *streamableHTTPTransport) CallTool(ctx context.Context, name string, args map[string]interface{}) (string, error) {
	params, _ := json.Marshal(ToolCallParams{Name: name, Arguments: args})
	res, err := t.rpc(ctx, "tools/call", json.RawMessage(params))
	if err != nil {
		return "", err
	}
	return parseToolCallResult(res)
}

func (t *streamableHTTPTransport) Close() error { return nil }

func (t *streamableHTTPTransport) rpc(ctx context.Context, method string, params json.RawMessage) (json.RawMessage, error) {
	id := atomic.AddInt64(&rpcID, 1)
	req := JSONRPCRequest{JSONRPC: "2.0", ID: id, Method: method, Params: params}
	body, err := json.Marshal(req)
	if err != nil {
		return nil, err
	}
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, t.server.URL, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Accept", "application/json")
	for k, v := range t.server.Headers {
		httpReq.Header.Set(k, v)
	}
	resp, err := t.client.Do(httpReq)
	if err != nil {
		return nil, normalizeTransportErr(err)
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(resp.Body)
	if resp.StatusCode == 401 || resp.StatusCode == 403 {
		return nil, fmt.Errorf("mcp auth failed (HTTP %d)", resp.StatusCode)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("mcp HTTP %d: %s", resp.StatusCode, truncateStr(string(data), 200))
	}
	var rpcResp JSONRPCResponse
	if err := json.Unmarshal(data, &rpcResp); err != nil {
		return nil, fmt.Errorf("mcp invalid response: %w", err)
	}
	if rpcResp.Error != nil {
		return nil, fmt.Errorf("mcp rpc error %d: %s", rpcResp.Error.Code, rpcResp.Error.Message)
	}
	b, err := json.Marshal(rpcResp.Result)
	if err != nil {
		return nil, err
	}
	return b, nil
}

// --- SSE ---

type sseTransport struct {
	server   ServerConfig
	client   *http.Client
	postURL  string
}

func newSSETransport(server ServerConfig) (*sseTransport, error) {
	timeout := time.Duration(server.TimeoutMS) * time.Millisecond
	if timeout <= 0 {
		timeout = DefaultTimeoutMS * time.Millisecond
	}
	return &sseTransport{
		server: server,
		client: &http.Client{Timeout: timeout},
	}, nil
}

func (t *sseTransport) ensureEndpoint(ctx context.Context) error {
	if t.postURL != "" {
		return nil
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, t.server.URL, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "text/event-stream")
	for k, v := range t.server.Headers {
		req.Header.Set(k, v)
	}
	resp, err := t.client.Do(req)
	if err != nil {
		return normalizeTransportErr(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode == 401 || resp.StatusCode == 403 {
		return fmt.Errorf("mcp auth failed (HTTP %d)", resp.StatusCode)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("mcp SSE connect HTTP %d: %s", resp.StatusCode, truncateStr(string(body), 200))
	}
	scanner := bufio.NewScanner(resp.Body)
	var eventType string
	deadline := time.After(10 * time.Second)
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-deadline:
			return fmt.Errorf("mcp SSE: endpoint not received")
		default:
		}
		if !scanner.Scan() {
			break
		}
		line := scanner.Text()
		if strings.HasPrefix(line, "event: ") {
			eventType = strings.TrimPrefix(line, "event: ")
			continue
		}
		if strings.HasPrefix(line, "data: ") {
			data := strings.TrimPrefix(line, "data: ")
			if eventType == "endpoint" {
				t.postURL = strings.TrimSpace(data)
				return nil
			}
		}
		if line == "" {
			eventType = ""
		}
	}
	return fmt.Errorf("mcp SSE: endpoint not received")
}

func (t *sseTransport) rpc(ctx context.Context, method string, params json.RawMessage) (json.RawMessage, error) {
	if err := t.ensureEndpoint(ctx); err != nil {
		return nil, err
	}
	id := atomic.AddInt64(&rpcID, 1)
	req := JSONRPCRequest{JSONRPC: "2.0", ID: id, Method: method, Params: params}
	body, err := json.Marshal(req)
	if err != nil {
		return nil, err
	}
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, t.postURL, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	for k, v := range t.server.Headers {
		httpReq.Header.Set(k, v)
	}
	resp, err := t.client.Do(httpReq)
	if err != nil {
		return nil, normalizeTransportErr(err)
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(resp.Body)
	var rpcResp JSONRPCResponse
	if err := json.Unmarshal(data, &rpcResp); err != nil {
		return nil, fmt.Errorf("mcp invalid response: %w", err)
	}
	if rpcResp.Error != nil {
		return nil, fmt.Errorf("mcp rpc error %d: %s", rpcResp.Error.Code, rpcResp.Error.Message)
	}
	b, err := json.Marshal(rpcResp.Result)
	if err != nil {
		return nil, err
	}
	return b, nil
}

func (t *sseTransport) ListTools(ctx context.Context) ([]Tool, error) {
	res, err := t.rpc(ctx, "tools/list", nil)
	if err != nil {
		return nil, err
	}
	return parseToolsListResult(res)
}

func (t *sseTransport) CallTool(ctx context.Context, name string, args map[string]interface{}) (string, error) {
	params, _ := json.Marshal(ToolCallParams{Name: name, Arguments: args})
	res, err := t.rpc(ctx, "tools/call", json.RawMessage(params))
	if err != nil {
		return "", err
	}
	return parseToolCallResult(res)
}

func (t *sseTransport) Close() error { return nil }

// --- stdio (stub) ---

type stdioTransport struct {
	server ServerConfig
}

func (t *stdioTransport) ListTools(ctx context.Context) ([]Tool, error) {
	return nil, fmt.Errorf("stdio transport is not implemented for server %q", t.server.ID)
}

func (t *stdioTransport) CallTool(ctx context.Context, name string, args map[string]interface{}) (string, error) {
	return "", fmt.Errorf("stdio transport is not implemented for server %q", t.server.ID)
}

func (t *stdioTransport) Close() error { return nil }

var rpcID int64

func parseToolsListResult(raw json.RawMessage) ([]Tool, error) {
	var result struct {
		Tools []Tool `json:"tools"`
	}
	if err := json.Unmarshal(raw, &result); err != nil {
		return nil, err
	}
	return result.Tools, nil
}

func parseToolCallResult(raw json.RawMessage) (string, error) {
	var result struct {
		Content []struct {
			Type string `json:"type"`
			Text string `json:"text"`
		} `json:"content"`
		IsError bool `json:"isError"`
	}
	if err := json.Unmarshal(raw, &result); err != nil {
		return string(raw), nil
	}
	var parts []string
	for _, c := range result.Content {
		if c.Text != "" {
			parts = append(parts, c.Text)
		}
	}
	out := strings.Join(parts, "\n")
	if result.IsError {
		return out, fmt.Errorf("tool returned error: %s", out)
	}
	return out, nil
}

func normalizeTransportErr(err error) error {
	if err == nil {
		return nil
	}
	if strings.Contains(err.Error(), "timeout") || strings.Contains(err.Error(), "deadline") {
		return fmt.Errorf("mcp timeout: %w", err)
	}
	return err
}

func truncateStr(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "..."
}
