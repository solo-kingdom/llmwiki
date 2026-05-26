package sqlite

import (
	"testing"
)

func TestAppConfig(t *testing.T) {
	db := openTestDB(t)

	val, err := db.GetConfig("nonexistent")
	if err != nil {
		t.Fatalf("GetConfig nonexistent: %v", err)
	}
	if val != "" {
		t.Errorf("expected empty for nonexistent key, got %q", val)
	}

	if err := db.SetConfig("temperature", "0.7"); err != nil {
		t.Fatalf("SetConfig: %v", err)
	}

	val, err = db.GetConfig("temperature")
	if err != nil {
		t.Fatalf("GetConfig: %v", err)
	}
	if val != "0.7" {
		t.Errorf("expected '0.7', got %q", val)
	}

	if err := db.SetConfig("temperature", "0.9"); err != nil {
		t.Fatalf("SetConfig update: %v", err)
	}
	val, _ = db.GetConfig("temperature")
	if val != "0.9" {
		t.Errorf("expected '0.9' after update, got %q", val)
	}

	all, err := db.GetAllConfig()
	if err != nil {
		t.Fatalf("GetAllConfig: %v", err)
	}
	if all["temperature"] != "0.9" {
		t.Errorf("expected temperature='0.9' in all, got %q", all["temperature"])
	}
}

func TestProviderKeys(t *testing.T) {
	db := openTestDB(t)

	has, err := db.HasProviderKey("openai")
	if err != nil {
		t.Fatalf("HasProviderKey: %v", err)
	}
	if has {
		t.Error("expected no key initially")
	}

	if err := db.SetProviderKey("openai", "sk-test123", ""); err != nil {
		t.Fatalf("SetProviderKey: %v", err)
	}

	key, baseURL, err := db.GetProviderKey("openai")
	if err != nil {
		t.Fatalf("GetProviderKey: %v", err)
	}
	if key != "sk-test123" {
		t.Errorf("expected 'sk-test123', got %q", key)
	}
	if baseURL != "" {
		t.Errorf("expected empty baseURL, got %q", baseURL)
	}

	has, _ = db.HasProviderKey("openai")
	if !has {
		t.Error("expected key to exist after set")
	}

	if err := db.SetProviderKey("openai", "sk-updated", "https://custom.api/v1"); err != nil {
		t.Fatalf("SetProviderKey update: %v", err)
	}
	key, baseURL, _ = db.GetProviderKey("openai")
	if key != "sk-updated" {
		t.Errorf("expected 'sk-updated', got %q", key)
	}
	if baseURL != "https://custom.api/v1" {
		t.Errorf("expected custom baseURL, got %q", baseURL)
	}

	if err := db.DeleteProviderKey("openai"); err != nil {
		t.Fatalf("DeleteProviderKey: %v", err)
	}
	key, _, _ = db.GetProviderKey("openai")
	if key != "" {
		t.Errorf("expected empty after delete, got %q", key)
	}
}

func TestProviderKeysList(t *testing.T) {
	db := openTestDB(t)

	db.SetProviderKey("openai", "sk-o", "")
	db.SetProviderKey("anthropic", "sk-a", "")

	keys, err := db.ListProviderKeys()
	if err != nil {
		t.Fatalf("ListProviderKeys: %v", err)
	}
	if len(keys) != 2 {
		t.Fatalf("expected 2 keys, got %d", len(keys))
	}
}

func TestProviderCache(t *testing.T) {
	db := openTestDB(t)

	empty, err := db.CacheIsEmpty()
	if err != nil {
		t.Fatalf("CacheIsEmpty: %v", err)
	}
	if !empty {
		t.Error("expected cache to be empty initially")
	}

	providers := []ProviderInfo{
		{ID: "openai", Name: "OpenAI", APIBase: "", APIFormat: "openai", EnvKey: "OPENAI_API_KEY"},
		{ID: "anthropic", Name: "Anthropic", APIBase: "", APIFormat: "anthropic", EnvKey: "ANTHROPIC_API_KEY"},
		{ID: "ollama", Name: "Ollama", APIBase: "http://localhost:11434", APIFormat: "ollama", EnvKey: ""},
	}
	if err := db.UpsertProviderInfo(providers); err != nil {
		t.Fatalf("UpsertProviderInfo: %v", err)
	}

	empty, _ = db.CacheIsEmpty()
	if empty {
		t.Error("expected cache to not be empty after upsert")
	}

	got, err := db.ListProviders()
	if err != nil {
		t.Fatalf("ListProviders: %v", err)
	}
	if len(got) != 3 {
		t.Fatalf("expected 3 providers, got %d", len(got))
	}

	p, err := db.GetProviderInfo("openai")
	if err != nil {
		t.Fatalf("GetProviderInfo: %v", err)
	}
	if p == nil || p.Name != "OpenAI" {
		t.Errorf("expected OpenAI, got %+v", p)
	}

	p, _ = db.GetProviderInfo("nonexistent")
	if p != nil {
		t.Error("expected nil for nonexistent provider")
	}
}

func TestModelCache(t *testing.T) {
	db := openTestDB(t)

	db.UpsertProviderInfo([]ProviderInfo{
		{ID: "openai", Name: "OpenAI", APIFormat: "openai"},
	})

	models := []ModelInfo{
		{ProviderID: "openai", ModelID: "gpt-4o", Name: "GPT-4o", ContextLimit: 128000, OutputLimit: 16384, Reasoning: true, ToolCall: true, Attachment: true},
		{ProviderID: "openai", ModelID: "gpt-4o-mini", Name: "GPT-4o Mini", ContextLimit: 128000, OutputLimit: 16384},
	}
	if err := db.UpsertModels(models); err != nil {
		t.Fatalf("UpsertModels: %v", err)
	}

	got, err := db.ListModelsByProvider("openai")
	if err != nil {
		t.Fatalf("ListModelsByProvider: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("expected 2 models, got %d", len(got))
	}
	if got[0].ContextLimit != 128000 {
		t.Errorf("expected context_limit 128000, got %d", got[0].ContextLimit)
	}
}

func TestIngestSessionsWithLLM(t *testing.T) {
	db := openTestDB(t)

	session := &IngestSession{
		Title:         "test session",
		LLMInstanceID: "inst_test1234",
		LLMModel:      "claude-3.5",
	}
	if err := db.CreateIngestSession(session); err != nil {
		t.Fatalf("CreateIngestSession: %v", err)
	}
	if session.ID == "" {
		t.Fatal("expected session ID to be set")
	}
	if session.LLMInstanceID != "inst_test1234" {
		t.Errorf("expected instance_id 'inst_test1234', got %q", session.LLMInstanceID)
	}

	got, err := db.GetIngestSession(session.ID)
	if err != nil {
		t.Fatalf("GetIngestSession: %v", err)
	}
	if got.LLMInstanceID != "inst_test1234" {
		t.Errorf("expected instance_id 'inst_test1234', got %q", got.LLMInstanceID)
	}
	if got.LLMModel != "claude-3.5" {
		t.Errorf("expected model 'claude-3.5', got %q", got.LLMModel)
	}

	sessions, err := db.ListIngestSessions()
	if err != nil {
		t.Fatalf("ListIngestSessions: %v", err)
	}
	if len(sessions) != 1 {
		t.Fatalf("expected 1 session, got %d", len(sessions))
	}

	if err := db.UpdateIngestSessionLLM(session.ID, "inst_other12", "gpt-4o"); err != nil {
		t.Fatalf("UpdateIngestSessionLLM: %v", err)
	}
	got, _ = db.GetIngestSession(session.ID)
	if got.LLMInstanceID != "inst_other12" {
		t.Errorf("expected instance_id 'inst_other12' after update, got %q", got.LLMInstanceID)
	}
	if got.LLMModel != "gpt-4o" {
		t.Errorf("expected model 'gpt-4o' after update, got %q", got.LLMModel)
	}
}

func openTestDB(t *testing.T) *DB {
	t.Helper()
	db, err := Open(t.TempDir() + "/test.db")
	if err != nil {
		t.Fatalf("open test db: %v", err)
	}
	t.Cleanup(func() { db.Close() })
	return db
}

func TestSessionModeDefault(t *testing.T) {
	db := openTestDB(t)

	session := &IngestSession{Title: "mode test"}
	if err := db.CreateIngestSession(session); err != nil {
		t.Fatalf("CreateIngestSession: %v", err)
	}
	if session.Mode != "ingest" {
		t.Errorf("expected default mode 'ingest', got %q", session.Mode)
	}

	got, err := db.GetIngestSession(session.ID)
	if err != nil {
		t.Fatalf("GetIngestSession: %v", err)
	}
	if got.Mode != "ingest" {
		t.Errorf("expected mode 'ingest' from DB, got %q", got.Mode)
	}
}

func TestSessionModeExplicit(t *testing.T) {
	db := openTestDB(t)

	for _, mode := range []string{"ingest", "qa", "organize"} {
		session := &IngestSession{Title: "mode " + mode, Mode: mode}
		if err := db.CreateIngestSession(session); err != nil {
			t.Fatalf("CreateIngestSession(mode=%s): %v", mode, err)
		}
		if session.Mode != mode {
			t.Errorf("expected mode %q, got %q", mode, session.Mode)
		}
	}
}

func TestSessionModeUpdate(t *testing.T) {
	db := openTestDB(t)

	session := &IngestSession{Title: "update mode"}
	if err := db.CreateIngestSession(session); err != nil {
		t.Fatalf("CreateIngestSession: %v", err)
	}

	if err := db.UpdateIngestSessionMode(session.ID, "organize"); err != nil {
		t.Fatalf("UpdateIngestSessionMode: %v", err)
	}

	got, err := db.GetIngestSession(session.ID)
	if err != nil {
		t.Fatalf("GetIngestSession: %v", err)
	}
	if got.Mode != "organize" {
		t.Errorf("expected mode 'organize' after update, got %q", got.Mode)
	}

	// Switch to qa
	if err := db.UpdateIngestSessionMode(session.ID, "qa"); err != nil {
		t.Fatalf("UpdateIngestSessionMode qa: %v", err)
	}
	got, _ = db.GetIngestSession(session.ID)
	if got.Mode != "qa" {
		t.Errorf("expected mode 'qa' after second update, got %q", got.Mode)
	}
}

func TestSessionModeMigration(t *testing.T) {
	db := openTestDB(t)

	// Migration should be idempotent
	if err := MigrateAddSessionMode(db); err != nil {
		t.Fatalf("MigrateAddSessionMode (second call): %v", err)
	}

	// Verify column exists and works
	session := &IngestSession{Title: "post-migration", Mode: "qa"}
	if err := db.CreateIngestSession(session); err != nil {
		t.Fatalf("CreateIngestSession after migration: %v", err)
	}
	if session.Mode != "qa" {
		t.Errorf("expected mode 'qa', got %q", session.Mode)
	}
}
