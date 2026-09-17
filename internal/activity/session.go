package activity

import (
	"fmt"
	"strings"
	"time"

	"github.com/solo-kingdom/llmwiki/internal/store/sqlite"
)

// LogSession records a session archive or stream event.
func LogSession(db *sqlite.DB, action, sessionID, message, status, source string, details map[string]interface{}) {
	if db == nil {
		return
	}
	level := "info"
	if status == "failure" || action == "stream_error" {
		level = "error"
	}
	if message == "" {
		message = fmt.Sprintf("会话 %s：%s", sessionID, action)
	}
	d := map[string]interface{}{"session_id": sessionID}
	for k, v := range details {
		d[k] = v
	}
	Record(db, Entry{
		Level:        level,
		Category:     "session",
		Action:       action,
		Message:      message,
		ResourceType: "ingest_session",
		ResourceID:   sessionID,
		Status:       status,
		Source:       source,
		Details:      d,
	})
}

// LogMCPTool records an MCP tool invocation.
func LogMCPTool(db *sqlite.DB, toolName string) {
	if db == nil || toolName == "" {
		return
	}
	Record(db, Entry{
		Level:        "info",
		Category:     "mcp",
		Action:       "tool_called",
		Message:      fmt.Sprintf("MCP 工具调用：%s", toolName),
		ResourceType: "mcp_tool",
		ResourceID:   toolName,
		Status:       "success",
		Source:       "mcp",
		Details: map[string]interface{}{
			"tool": toolName,
		},
	})
}

// MCPToolCallInfo holds metadata for a remote MCP tool call audit log.
type MCPToolCallInfo struct {
	ToolName    string
	RemoteAddr  string
	ClientAgent string
	Duration    time.Duration
	Status      string // success, failure, denied
	ErrorType   string // e.g. "policy_denied", "execution_error", "auth_failure"
}

// sanitizeRemoteAddr truncates and masks the remote address for logging.
// It keeps only the first two octets for IPv4 to avoid logging full client IPs.
func sanitizeRemoteAddr(addr string) string {
	// Strip port
	if idx := strings.LastIndex(addr, ":"); idx > 0 {
		addr = addr[:idx]
	}
	// For IPv4, keep first two octets
	parts := strings.Split(addr, ".")
	if len(parts) == 4 {
		return parts[0] + "." + parts[1] + ".*.*"
	}
	// For IPv6 or other, just truncate
	if len(addr) > 20 {
		return addr[:20] + "..."
	}
	return addr
}

// LogMCPRemoteToolCall records a structured audit log for a remote MCP tool call.
// It ensures no sensitive data (tokens, full args, full results) is logged.
func LogMCPRemoteToolCall(db *sqlite.DB, info MCPToolCallInfo) {
	if db == nil {
		return
	}
	level := "info"
	if info.Status == "failure" || info.Status == "denied" {
		level = "warn"
	}

	details := map[string]interface{}{
		"tool":        info.ToolName,
		"remote_addr": sanitizeRemoteAddr(info.RemoteAddr),
		"duration_ms": info.Duration.Milliseconds(),
	}
	if info.ClientAgent != "" {
		details["client_agent"] = info.ClientAgent
	}
	if info.ErrorType != "" {
		details["error_type"] = info.ErrorType
	}

	Record(db, Entry{
		Level:        level,
		Category:     "mcp",
		Action:       "remote_tool_called",
		Message:      fmt.Sprintf("远程 MCP 工具调用：%s (%s)", info.ToolName, info.Status),
		ResourceType: "mcp_tool",
		ResourceID:   info.ToolName,
		Status:       info.Status,
		Source:       "mcp-remote",
		Details:      details,
	})
}
