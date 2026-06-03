package mcp

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"sync"
	"time"
)

// JSONRPCRequest is a JSON-RPC 2.0 request.
type JSONRPCRequest struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      interface{}     `json:"id,omitempty"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"`
}

// JSONRPCResponse is a JSON-RPC 2.0 response.
type JSONRPCResponse struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      interface{}     `json:"id,omitempty"`
	Result  interface{}     `json:"result,omitempty"`
	Error   *JSONRPCError   `json:"error,omitempty"`
}

// JSONRPCError is a JSON-RPC 2.0 error.
type JSONRPCError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

// Tool represents an MCP tool.
type Tool struct {
	Name        string                 `json:"name"`
	Description string                 `json:"description"`
	InputSchema map[string]interface{} `json:"inputSchema"`
}

// ToolCallParams contains the parameters for a tools/call request.
type ToolCallParams struct {
	Name      string                 `json:"name"`
	Arguments map[string]interface{} `json:"arguments"`
}

// ToolHandler is a function that handles a tool call.
type ToolHandler func(args map[string]interface{}) (string, error)

// ToolPolicy controls which tools are visible and callable over the MCP RPC endpoint.
type ToolPolicy struct {
	// AllowWriteTools controls whether mutating tools (write, delete) are exposed.
	AllowWriteTools bool
	// ReadonlyTools is the set of tool names treated as safe/readonly.
	ReadonlyTools map[string]bool
	// WriteTools is the set of tool names that mutate workspace state.
	WriteTools map[string]bool
}

// DefaultToolPolicy returns the standard readonly-by-default policy.
func DefaultToolPolicy(allowWrite bool) ToolPolicy {
	return ToolPolicy{
		AllowWriteTools: allowWrite,
		ReadonlyTools: map[string]bool{
			"guide": true, "search": true, "read": true,
			"references": true, "lint": true, "ping": true,
		},
		WriteTools: map[string]bool{
			"write": true, "delete": true,
		},
	}
}

// IsAllowed reports whether the given tool name is permitted under this policy.
func (p ToolPolicy) IsAllowed(name string) bool {
	// Readonly tools are always allowed
	if p.ReadonlyTools[name] {
		return true
	}
	// Write tools require explicit permission
	if p.WriteTools[name] {
		return p.AllowWriteTools
	}
	// Unknown tools are allowed by default (e.g. test tools, future tools)
	return true
}

// FilterTools returns only the tools allowed by this policy.
func (p ToolPolicy) FilterTools(tools []Tool) []Tool {
	out := make([]Tool, 0, len(tools))
	for _, t := range tools {
		if p.IsAllowed(t.Name) {
			out = append(out, t)
		}
	}
	return out
}

// Server is an MCP JSON-RPC 2.0 server over stdio.
type Server struct {
	name         string
	instructions string
	tools        []Tool
	handlers     map[string]ToolHandler
	policy       ToolPolicy
	auditDB      AuditDB
	mu           sync.RWMutex
}

// AuditDB is a minimal interface for recording audit logs without importing sqlite directly.
type AuditDB interface {
	RecordMCPToolCall(toolName, remoteAddr, clientAgent string, duration time.Duration, status, errorType string)
}

// NewServer creates a new MCP server.
func NewServer(name, instructions string) *Server {
	return &Server{
		name:         name,
		instructions: instructions,
		handlers:     make(map[string]ToolHandler),
		policy:       DefaultToolPolicy(false),
	}
}

// SetToolPolicy sets the tool access policy for the server.
func (s *Server) SetToolPolicy(policy ToolPolicy) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.policy = policy
}

// GetToolPolicy returns the current tool policy (read-only snapshot not needed due to value type).
func (s *Server) GetToolPolicy() ToolPolicy {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.policy
}

// SetAuditDB sets the database for recording remote MCP audit logs.
func (s *Server) SetAuditDB(db AuditDB) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.auditDB = db
}

// RegisterTool registers a tool with its handler.
func (s *Server) RegisterTool(tool Tool, handler ToolHandler) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.tools = append(s.tools, tool)
	s.handlers[tool.Name] = handler
}

// Run starts the MCP server on stdin/stdout.
func (s *Server) Run() error {
	log.SetOutput(os.Stderr)
	log.SetPrefix("[mcp] ")

	reader := bufio.NewReader(os.Stdin)
	writer := os.Stdout

	for {
		line, err := reader.ReadBytes('\n')
		if err != nil {
			if err == io.EOF {
				return nil
			}
			log.Printf("read error: %v", err)
			return err
		}

		var req JSONRPCRequest
		if err := json.Unmarshal(line, &req); err != nil {
			log.Printf("parse error: %v", err)
			continue
		}

		resp := s.handleRequest(&req)
		if resp == nil {
			continue // notification, no response needed
		}

		data, err := json.Marshal(resp)
		if err != nil {
			log.Printf("marshal error: %v", err)
			continue
		}

		if _, err := fmt.Fprintf(writer, "%s\n", data); err != nil {
			log.Printf("write error: %v", err)
			return err
		}
	}
}

func NewHTTPHandler(server *Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, `{"jsonrpc":"2.0","error":{"code":-32600,"message":"Method not allowed"}}`, http.StatusMethodNotAllowed)
			return
		}

		var req JSONRPCRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(JSONRPCResponse{
				JSONRPC: "2.0",
				Error:   &JSONRPCError{Code: -32700, Message: "Parse error"},
			})
			return
		}

		// Capture audit info for tools/call
		auditInfo := &httpCallAudit{
			remoteAddr:  r.RemoteAddr,
			clientAgent: r.Header.Get("MCP-Client-Name"),
			userAgent:   r.Header.Get("User-Agent"),
		}
		if auditInfo.clientAgent == "" {
			if ua := auditInfo.userAgent; len(ua) > 100 {
				auditInfo.clientAgent = ua[:100]
			} else {
				auditInfo.clientAgent = ua
			}
		}

		resp := server.handleHTTPRequest(&req, auditInfo)
		if resp == nil {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
	}
}

type httpCallAudit struct {
	remoteAddr  string
	clientAgent string
	userAgent   string
}

func (s *Server) handleRequest(req *JSONRPCRequest) *JSONRPCResponse {
	return s.handleRequestWithAudit(req, nil)
}

// handleHTTPRequest is like handleRequest but captures HTTP audit metadata.
func (s *Server) handleHTTPRequest(req *JSONRPCRequest, audit *httpCallAudit) *JSONRPCResponse {
	return s.handleRequestWithAudit(req, audit)
}

func (s *Server) handleRequestWithAudit(req *JSONRPCRequest, audit *httpCallAudit) *JSONRPCResponse {
	switch req.Method {
	case "initialize":
		return s.handleInitialize(req)
	case "notifications/initialized":
		return nil // No response for notifications
	case "tools/list":
		return s.handleToolsList(req)
	case "tools/call":
		return s.handleToolsCallWithAudit(req, audit)
	default:
		return &JSONRPCResponse{
			JSONRPC: "2.0",
			ID:      req.ID,
			Error:   &JSONRPCError{Code: -32601, Message: fmt.Sprintf("Method not found: %s", req.Method)},
		}
	}
}

func (s *Server) handleInitialize(req *JSONRPCRequest) *JSONRPCResponse {
	policy := s.GetToolPolicy()
	defaultPolicy := "readonly"
	if policy.AllowWriteTools {
		defaultPolicy = "readwrite"
	}

	return &JSONRPCResponse{
		JSONRPC: "2.0",
		ID:      req.ID,
		Result: map[string]interface{}{
			"protocolVersion": "2025-03-26",
			"capabilities": map[string]interface{}{
				"tools": map[string]interface{}{},
			},
			"serverInfo": map[string]interface{}{
				"name":    s.name,
				"version": "0.1.0",
			},
			"instructions": s.instructions,
			"_meta": map[string]interface{}{
				"accessModel":       "rpc-first",
				"transport":         "http-post-jsonrpc",
				"auth":              "required-when-remote",
				"defaultToolPolicy": defaultPolicy,
				"compatibility":     "First release focuses on RPC access via HTTP POST. Direct Claude Desktop stdio connection is not required.",
			},
		},
	}
}

func (s *Server) handleToolsList(req *JSONRPCRequest) *JSONRPCResponse {
	s.mu.RLock()
	policy := s.policy
	tools := s.tools
	s.mu.RUnlock()

	filtered := policy.FilterTools(tools)
	return &JSONRPCResponse{
		JSONRPC: "2.0",
		ID:      req.ID,
		Result: map[string]interface{}{
			"tools": filtered,
		},
	}
}

func (s *Server) handleToolsCallWithAudit(req *JSONRPCRequest, audit *httpCallAudit) *JSONRPCResponse {
	var params ToolCallParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return &JSONRPCResponse{
			JSONRPC: "2.0",
			ID:      req.ID,
			Error:   &JSONRPCError{Code: -32602, Message: fmt.Sprintf("Invalid params: %v", err)},
		}
	}

	s.mu.RLock()
	policy := s.policy
	handler, ok := s.handlers[params.Name]
	auditDB := s.auditDB
	s.mu.RUnlock()

	if !ok || !policy.IsAllowed(params.Name) {
		// Audit: policy denied
		if audit != nil && auditDB != nil {
			errorType := "unknown_tool"
			if ok && !policy.IsAllowed(params.Name) {
				errorType = "policy_denied"
			}
			auditDB.RecordMCPToolCall(params.Name, audit.remoteAddr, audit.clientAgent, 0, "denied", errorType)
		}
		return &JSONRPCResponse{
			JSONRPC: "2.0",
			ID:      req.ID,
			Error:   &JSONRPCError{Code: -32000, Message: fmt.Sprintf("Tool not found or disabled by policy: %s", params.Name)},
		}
	}

	if params.Arguments == nil {
		params.Arguments = make(map[string]interface{})
	}

	start := time.Now()
	result, err := handler(params.Arguments)
	elapsed := time.Since(start)

	// Audit: record result
	if audit != nil && auditDB != nil {
		status := "success"
		errorType := ""
		if err != nil {
			status = "failure"
			errorType = "execution_error"
		}
		auditDB.RecordMCPToolCall(params.Name, audit.remoteAddr, audit.clientAgent, elapsed, status, errorType)
	}

	if err != nil {
		return &JSONRPCResponse{
			JSONRPC: "2.0",
			ID:      req.ID,
			Result: map[string]interface{}{
				"content": []map[string]interface{}{
					{"type": "text", "text": fmt.Sprintf("Error: %v", err)},
				},
				"isError": true,
			},
		}
	}

	return &JSONRPCResponse{
		JSONRPC: "2.0",
		ID:      req.ID,
		Result: map[string]interface{}{
			"content": []map[string]interface{}{
				{"type": "text", "text": result},
			},
			"isError": false,
		},
	}
}
