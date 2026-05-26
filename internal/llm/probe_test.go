package llm

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestProbeOpenAICompatible(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/models" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
		if r.Header.Get("Authorization") != "Bearer sk-test" {
			t.Errorf("missing auth header")
		}
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"data":[]}`))
	}))
	defer srv.Close()

	c := NewClient(Config{
		Provider: "openai",
		BaseURL:  srv.URL + "/v1",
		APIKey:   "sk-test",
		Model:    "probe",
	})
	if err := c.Probe(context.Background()); err != nil {
		t.Fatalf("Probe: %v", err)
	}
}

func TestProbeAuthFailure(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		w.Write([]byte(`{"error":"invalid key"}`))
	}))
	defer srv.Close()

	c := NewClient(Config{
		Provider: "openai",
		BaseURL:  srv.URL + "/v1",
		APIKey:   "bad",
		Model:    "probe",
	})
	if err := c.Probe(context.Background()); err == nil {
		t.Fatal("expected auth error")
	}
}

func TestProbeMissingBaseURL(t *testing.T) {
	c := NewClient(Config{
		Provider: "openai",
		BaseURL:  "",
		APIKey:   "sk-test",
		Model:    "probe",
	})
	if err := c.Probe(context.Background()); err == nil {
		t.Fatal("expected base URL error")
	}
}
