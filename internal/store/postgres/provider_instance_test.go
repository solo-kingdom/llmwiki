package postgres_test

import (
	"strings"
	"testing"

	"github.com/solo-kingdom/llmwiki/internal/store"
	"github.com/solo-kingdom/llmwiki/internal/store/postgres/pgtest"
)

func TestProviderInstanceCRUDAndMask(t *testing.T) {
	db := pgtest.Open(t)

	inst := &store.ProviderInstance{
		Name:      "OpenAI Work",
		CatalogID: "openai",
		APIKey:    "sk-test-key-12345678",
	}
	if err := db.CreateProviderInstance(inst); err != nil {
		t.Fatalf("Create: %v", err)
	}
	if len(inst.ID) != 13 || !strings.HasPrefix(inst.ID, "inst_") {
		t.Fatalf("expected ID format inst_xxxxxxxx, got %q", inst.ID)
	}
	if inst.CreatedAt == "" || inst.UpdatedAt == "" {
		t.Fatalf("expected timestamps backfilled, got %+v", inst)
	}

	got, err := db.GetProviderInstance(inst.ID)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got == nil {
		t.Fatal("expected instance, got nil")
	}
	if got.Name != "OpenAI Work" || got.CatalogID != "openai" {
		t.Fatalf("unexpected instance: %+v", got)
	}
	if got.APIKey != "sk-test-key-12345678" {
		t.Fatalf("expected raw api_key from store, got %q", got.APIKey)
	}
	// Masking lives in the API layer; the store must not populate the mask.
	if got.APIKeyMask != "" {
		t.Fatalf("store should not mask api_key, got %q", got.APIKeyMask)
	}

	if _, err := db.GetProviderInstance("inst_missing"); err != nil {
		t.Fatalf("Get missing: %v", err)
	} else if inst, _ := db.GetProviderInstance("inst_missing"); inst != nil {
		t.Fatalf("Get missing = %+v, want nil", inst)
	}

	second := &store.ProviderInstance{
		Name:      "OpenAI Personal",
		CatalogID: "openai",
		APIKey:    "sk-personal-key",
	}
	if err := db.CreateProviderInstance(second); err != nil {
		t.Fatalf("Create second: %v", err)
	}
	instances, err := db.ListProviderInstances()
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(instances) != 2 {
		t.Fatalf("List len = %d, want 2", len(instances))
	}

	// Changing catalog keeps api_key/base_url when those arguments are empty.
	if err := db.UpdateProviderInstance(inst.ID, "Renamed", "anthropic", "", "https://proxy.example/v1"); err != nil {
		t.Fatalf("Update: %v", err)
	}
	got, err = db.GetProviderInstance(inst.ID)
	if err != nil {
		t.Fatalf("Get after update: %v", err)
	}
	if got.Name != "Renamed" || got.CatalogID != "anthropic" {
		t.Fatalf("unexpected after update: %+v", got)
	}
	if got.APIKey != "sk-test-key-12345678" {
		t.Fatalf("api_key changed unexpectedly: %q", got.APIKey)
	}
	if got.BaseURL != "https://proxy.example/v1" {
		t.Fatalf("base_url = %q, want updated value", got.BaseURL)
	}

	if err := db.UpdateProviderInstance(inst.ID, "", "", "sk-new-key", ""); err != nil {
		t.Fatalf("Update key: %v", err)
	}
	got, _ = db.GetProviderInstance(inst.ID)
	if got.APIKey != "sk-new-key" {
		t.Fatalf("api_key = %q, want sk-new-key", got.APIKey)
	}
	if got.Name != "Renamed" || got.BaseURL != "https://proxy.example/v1" {
		t.Fatalf("empty update fields should be ignored, got %+v", got)
	}

	if err := db.DeleteProviderInstance(inst.ID); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	got, err = db.GetProviderInstance(inst.ID)
	if err != nil || got != nil {
		t.Fatalf("Get after delete = %+v, %v; want nil, nil", got, err)
	}
	if err := db.DeleteProviderInstance(inst.ID); err == nil {
		t.Fatal("expected error deleting non-existent instance")
	}

	if err := db.CreateProviderInstance(&store.ProviderInstance{Name: "Bad"}); err == nil {
		t.Fatal("expected error for empty catalog_id")
	}
	if err := db.CreateProviderInstance(nil); err == nil {
		t.Fatal("expected error for nil instance")
	}
}
