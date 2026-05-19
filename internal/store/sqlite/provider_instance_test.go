package sqlite

import (
	"testing"
)

func TestProviderInstanceCRUD(t *testing.T) {
	db := openTestDB(t)

	// Create
	inst := &ProviderInstance{
		Name:      "OpenAI Work",
		CatalogID: "openai",
		APIKey:    "sk-test-key-12345678",
		BaseURL:   "",
	}
	if err := db.CreateProviderInstance(inst); err != nil {
		t.Fatalf("Create: %v", err)
	}
	if inst.ID == "" {
		t.Fatal("expected auto-generated ID")
	}
	if len(inst.ID) != 13 { // "inst_" + 8 hex chars
		t.Fatalf("expected ID format inst_xxxxxxxx, got %q", inst.ID)
	}

	// Get
	got, err := db.GetProviderInstance(inst.ID)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got == nil {
		t.Fatal("expected instance, got nil")
	}
	if got.Name != "OpenAI Work" {
		t.Fatalf("expected name 'OpenAI Work', got %q", got.Name)
	}
	if got.CatalogID != "openai" {
		t.Fatalf("expected catalog_id 'openai', got %q", got.CatalogID)
	}
	if got.APIKey != "sk-test-key-12345678" {
		t.Fatalf("expected api_key, got %q", got.APIKey)
	}

	// List
	instances, err := db.ListProviderInstances()
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(instances) != 1 {
		t.Fatalf("expected 1 instance, got %d", len(instances))
	}

	// Create second instance with same catalog_id (multi-account)
	inst2 := &ProviderInstance{
		Name:      "OpenAI Personal",
		CatalogID: "openai",
		APIKey:    "sk-personal-key",
		BaseURL:   "",
	}
	if err := db.CreateProviderInstance(inst2); err != nil {
		t.Fatalf("Create second: %v", err)
	}

	instances, err = db.ListProviderInstances()
	if err != nil {
		t.Fatalf("List after second: %v", err)
	}
	if len(instances) != 2 {
		t.Fatalf("expected 2 instances, got %d", len(instances))
	}

	// Update — change type but keep key
	if err := db.UpdateProviderInstance(inst.ID, "Renamed", "anthropic", "", ""); err != nil {
		t.Fatalf("Update: %v", err)
	}
	got, err = db.GetProviderInstance(inst.ID)
	if err != nil {
		t.Fatalf("Get after update: %v", err)
	}
	if got.Name != "Renamed" {
		t.Fatalf("expected renamed, got %q", got.Name)
	}
	if got.CatalogID != "anthropic" {
		t.Fatalf("expected catalog_id anthropic, got %q", got.CatalogID)
	}
	if got.APIKey != "sk-test-key-12345678" {
		t.Fatalf("key should NOT change on type change, got %q", got.APIKey)
	}

	// Delete
	if err := db.DeleteProviderInstance(inst.ID); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	got, err = db.GetProviderInstance(inst.ID)
	if err != nil {
		t.Fatalf("Get after delete: %v", err)
	}
	if got != nil {
		t.Fatal("expected nil after delete")
	}

	// Delete non-existent
	if err := db.DeleteProviderInstance("inst_notexist"); err == nil {
		t.Fatal("expected error deleting non-existent instance")
	}

	// Create without catalog_id should fail
	badInst := &ProviderInstance{Name: "Bad", CatalogID: ""}
	if err := db.CreateProviderInstance(badInst); err == nil {
		t.Fatal("expected error for empty catalog_id")
	}
}
