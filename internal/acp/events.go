package acp

import (
	"encoding/json"
	"fmt"
)

type PlanEntry struct {
	Content  string `json:"content"`
	Priority string `json:"priority,omitempty"`
	Status   string `json:"status"`
}

type Event struct {
	Kind          string
	Text          string
	ToolCallID    string
	ToolName      string
	ToolKind      string
	ToolStatus    string
	ToolTitle     string
	ToolRawInput  json.RawMessage
	ToolRawOutput json.RawMessage
	Plan          []PlanEntry
	Raw           map[string]any
}

// DecodeSessionUpdate maps an ACP session/update payload to the neutral event
// vocabulary consumed by internal/agentruntime.
func DecodeSessionUpdate(raw json.RawMessage) (Event, error) {
	var envelope map[string]any
	if err := json.Unmarshal(raw, &envelope); err != nil {
		return Event{}, fmt.Errorf("decode ACP session update: %w", err)
	}
	if nested, ok := envelope["update"]; ok {
		updateRaw, _ := json.Marshal(nested)
		if err := json.Unmarshal(updateRaw, &envelope); err != nil {
			return Event{}, fmt.Errorf("decode ACP update object: %w", err)
		}
	}
	kind, _ := envelope["sessionUpdate"].(string)
	event := Event{Kind: "ignored", Raw: envelope}
	switch kind {
	case "agent_message_chunk":
		event.Kind = "message"
		decodeContentBlock(envelope, &event)
	case "agent_thought_chunk":
		event.Kind = "thought"
		decodeContentBlock(envelope, &event)
	case "user_message_chunk":
		event.Kind = "user_echo"
		decodeContentBlock(envelope, &event)
	case "tool_call":
		event.Kind = "tool_call"
		decodeToolCall(envelope, &event)
	case "tool_call_update":
		event.Kind = "tool_call_update"
		decodeToolCall(envelope, &event)
	case "plan":
		event.Kind = "plan"
		decodePlan(envelope, &event)
	case "usage_update":
		event.Kind = "usage"
	default:
		event.Kind = "ignored"
	}
	return event, nil
}

func decodeContentBlock(update map[string]any, event *Event) {
	block, ok := update["content"].(map[string]any)
	if !ok {
		return
	}
	contentType, _ := block["type"].(string)
	if contentType == "text" {
		event.Text, _ = block["text"].(string)
		return
	}
	raw, _ := json.Marshal(block)
	event.ToolRawInput = raw
}

func decodeToolCall(update map[string]any, event *Event) {
	event.ToolCallID, _ = stringValue(update, "toolCallId", "tool_call_id")
	event.ToolTitle, _ = stringValue(update, "title")
	event.ToolName, _ = stringValue(update, "name")
	if event.ToolName == "" {
		event.ToolName = event.ToolTitle
	}
	event.ToolKind, _ = stringValue(update, "kind")
	event.ToolStatus, _ = stringValue(update, "status")
	event.ToolRawInput = rawValue(update, "rawInput", "raw_input")
	event.ToolRawOutput = rawValue(update, "rawOutput", "raw_output")
}

func decodePlan(update map[string]any, event *Event) {
	rawEntries, _ := update["entries"].([]any)
	for _, raw := range rawEntries {
		entry, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		content, _ := stringValue(entry, "content")
		priority, _ := stringValue(entry, "priority")
		status, _ := stringValue(entry, "status")
		event.Plan = append(event.Plan, PlanEntry{Content: content, Priority: priority, Status: status})
	}
}

func stringValue(m map[string]any, keys ...string) (string, bool) {
	for _, key := range keys {
		if value, ok := m[key].(string); ok {
			return value, true
		}
	}
	return "", false
}

func rawValue(m map[string]any, keys ...string) json.RawMessage {
	for _, key := range keys {
		if value, ok := m[key]; ok {
			raw, _ := json.Marshal(value)
			return raw
		}
	}
	return nil
}
