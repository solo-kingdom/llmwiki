package agentruntime

import (
	"context"
	"errors"

	"github.com/solo-kingdom/llmwiki/internal/ingest"
	"github.com/solo-kingdom/llmwiki/internal/store/sqlite"
)

const (
	KindNative = "native"
	KindACP    = "acp"
)

var (
	ErrNoProviderInstance = errors.New("no provider instance")
	ErrNoACPAgent         = errors.New("no ACP agent")
	ErrACPAgentDisabled   = errors.New("ACP agent disabled")
	ErrACPCLINotFound     = errors.New("ACP CLI not found")
	ErrACPConfigInvalid   = errors.New("ACP config invalid")
)

type PlanEntry struct {
	Content  string
	Priority string
	Status   string
}

type PermissionDecision struct {
	Outcome   string
	OptionID  string
	Allowed   bool
	Reason    string
	ToolKind  string
	ToolTitle string
}

// EventSink receives one turn's incremental ACP/native output.
type EventSink interface {
	Token(text string)
	Thought(text string)
	ToolStart(name, detail string)
	ToolDone(name, detail string)
	Plan(entries []PlanEntry)
	Permission(decision PermissionDecision)
	Warning(code, message string)
	Debug(step, phase, message string, payload map[string]any)
}

type PromptRequest struct {
	SessionID          string
	Mode               string
	DocLang            string
	UserContent        string
	DisplayUserContent string
	History            []sqlite.IngestSessionMessage
	WikiRefs           []ingest.WikiRefInput
	Recorder           *ingest.SessionMessageRecorder
}

type PromptResult struct {
	Text       string
	StopReason string
}

type Runtime interface {
	Kind() string
	Label() string
	Prompt(ctx context.Context, req PromptRequest, sink EventSink) (PromptResult, error)
}
