package acp

import (
	"encoding/json"
	"strings"
)

type PermissionRequest struct {
	SessionID  string             `json:"sessionId"`
	ToolCallID string             `json:"toolCallId"`
	ToolKind   string             `json:"-"`
	ToolTitle  string             `json:"-"`
	Options    []PermissionOption `json:"options"`
}

func (r *PermissionRequest) UnmarshalJSON(data []byte) error {
	var wire struct {
		SessionID string `json:"sessionId"`
		ToolCall  struct {
			ToolCallID string `json:"toolCallId"`
			Title      string `json:"title"`
			Kind       string `json:"kind"`
		} `json:"toolCall"`
		Options []PermissionOption `json:"options"`
	}
	if err := json.Unmarshal(data, &wire); err != nil {
		return err
	}
	r.SessionID = wire.SessionID
	r.ToolCallID = wire.ToolCall.ToolCallID
	r.ToolKind = wire.ToolCall.Kind
	r.ToolTitle = wire.ToolCall.Title
	r.Options = wire.Options
	return nil
}

type PermissionOption struct {
	OptionID string `json:"optionId"`
	Name     string `json:"name"`
	Kind     string `json:"kind"`
}

type PermissionDecision struct {
	Outcome   string `json:"outcome"`
	OptionID  string `json:"option_id,omitempty"`
	Allowed   bool   `json:"allowed"`
	Reason    string `json:"reason,omitempty"`
	ToolKind  string `json:"tool_kind"`
	ToolTitle string `json:"tool_title,omitempty"`
}

// Decide applies the non-interactive ACP permission matrix.
func Decide(policy PermissionPolicy, readonlyOnly bool, req PermissionRequest) PermissionDecision {
	kind := strings.ToLower(strings.TrimSpace(req.ToolKind))
	allowed := false
	switch kind {
	case "read":
		allowed = policy.AllowRead
	case "search":
		allowed = policy.AllowSearch
	case "think":
		allowed = true
	case "fetch":
		allowed = policy.AllowFetch
	case "edit", "delete", "move":
		allowed = policy.AllowWrite && !readonlyOnly
	case "execute":
		allowed = policy.AllowExecute && !readonlyOnly
	default:
		allowed = false
	}
	decision := PermissionDecision{
		Outcome: "cancelled", Allowed: false, ToolKind: kind, ToolTitle: req.ToolTitle,
	}
	targetKind := "reject_once"
	if allowed {
		targetKind = "allow_once"
		decision.Outcome = "selected"
		decision.Allowed = true
		decision.Reason = "policy_allowed"
	} else {
		decision.Outcome = "selected"
		decision.Reason = "policy_denied"
	}
	for _, option := range req.Options {
		if option.Kind == targetKind {
			decision.OptionID = option.OptionID
			return decision
		}
	}
	decision.Outcome = "cancelled"
	decision.OptionID = ""
	decision.Allowed = false
	decision.Reason = "no_matching_option"
	return decision
}

func CancelledDecision(req PermissionRequest) PermissionDecision {
	return PermissionDecision{
		Outcome: "cancelled", Allowed: false, Reason: "turn_cancelled",
		ToolKind: req.ToolKind, ToolTitle: req.ToolTitle,
	}
}
