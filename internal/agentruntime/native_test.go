package agentruntime

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/solo-kingdom/llmwiki/internal/store/sqlite"
)

type testSink struct {
	tokens   []string
	warnings []string
}

func (s *testSink) Token(text string)                            { s.tokens = append(s.tokens, text) }
func (s *testSink) Thought(string)                               {}
func (s *testSink) ToolStart(string, string)                     {}
func (s *testSink) ToolDone(string, string)                      {}
func (s *testSink) Plan([]PlanEntry)                             {}
func (s *testSink) Permission(PermissionDecision)                {}
func (s *testSink) Warning(code, message string)                 { s.warnings = append(s.warnings, code+":"+message) }
func (s *testSink) Debug(string, string, string, map[string]any) {}

func openRuntimeTestDB(t *testing.T) *sqlite.DB {
	t.Helper()
	db, err := sqlite.Open(t.TempDir() + "/test.db")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return db
}

func createRuntimeProvider(t *testing.T, db *sqlite.DB, baseURL string) *sqlite.ProviderInstance {
	t.Helper()
	instance := &sqlite.ProviderInstance{Name: "Mock", CatalogID: "openai", APIKey: "sk-test", BaseURL: baseURL + "/v1"}
	if err := db.CreateProviderInstance(instance); err != nil {
		t.Fatalf("CreateProviderInstance: %v", err)
	}
	return instance
}

func TestNativeRuntimeToolLoop(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"choices": []map[string]any{{"message": map[string]string{"content": "native tool loop answer"}}},
		})
	}))
	defer server.Close()
	db := openRuntimeTestDB(t)
	instance := createRuntimeProvider(t, db, server.URL)
	session := &sqlite.IngestSession{AgentKind: KindNative, LLMInstanceID: instance.ID, LLMModel: "gpt-4o"}
	runtime, err := Resolve(db, t.TempDir(), nil, session)
	if err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	sink := &testSink{}
	result, err := runtime.Prompt(context.Background(), PromptRequest{SessionID: "s1", Mode: "qa", DocLang: "zh", UserContent: "hello"}, sink)
	if err != nil {
		t.Fatalf("Prompt: %v", err)
	}
	if result.StopReason != "end_turn" || result.Text != "native tool loop answer" {
		t.Fatalf("result = %+v", result)
	}
	if strings.Join(sink.tokens, "") != "native tool loop answer" {
		t.Fatalf("tokens = %v", sink.tokens)
	}
}

func TestNativeRuntimeToolLoopFallback(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Stream bool `json:"stream"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		if !body.Stream {
			http.Error(w, "tool loop unavailable", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		for _, token := range []string{"fallback ", "answer"} {
			payload, _ := json.Marshal(map[string]any{"choices": []map[string]any{{"delta": map[string]string{"content": token}}}})
			fmt.Fprintf(w, "data: %s\n\n", payload)
		}
		fmt.Fprint(w, "data: [DONE]\n\n")
	}))
	defer server.Close()
	db := openRuntimeTestDB(t)
	instance := createRuntimeProvider(t, db, server.URL)
	session := &sqlite.IngestSession{AgentKind: KindNative, LLMInstanceID: instance.ID, LLMModel: "gpt-4o"}
	runtime, err := Resolve(db, t.TempDir(), nil, session)
	if err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	sink := &testSink{}
	result, err := runtime.Prompt(context.Background(), PromptRequest{SessionID: "s1", Mode: "qa", DocLang: "zh", UserContent: "hello"}, sink)
	if err != nil {
		t.Fatalf("Prompt: %v", err)
	}
	if result.Text != "fallback answer" || strings.Join(sink.tokens, "") != "fallback answer" {
		t.Fatalf("fallback result=%+v tokens=%v", result, sink.tokens)
	}
	if len(sink.warnings) == 0 || !strings.HasPrefix(sink.warnings[0], "tool_loop_failed:") {
		t.Fatalf("warnings = %v", sink.warnings)
	}
}

func TestResolveNativeMissingProvider(t *testing.T) {
	db := openRuntimeTestDB(t)
	_, err := Resolve(db, t.TempDir(), nil, &sqlite.IngestSession{AgentKind: KindNative})
	if !errors.Is(err, ErrNoProviderInstance) {
		t.Fatalf("Resolve error = %v, want ErrNoProviderInstance", err)
	}
}
