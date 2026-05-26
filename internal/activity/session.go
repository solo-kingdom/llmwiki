package activity

import (
	"fmt"

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
