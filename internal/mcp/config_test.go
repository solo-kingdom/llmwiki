package mcp

import (
	"strings"
	"testing"
)

func TestParseConfigEmpty(t *testing.T) {
	cfg, err := ParseConfig("")
	if err != nil {
		t.Fatal(err)
	}
	if !cfg.Defaults.ReadonlyOnly {
		t.Error("expected readonly_only default true")
	}
	if cfg.Servers == nil {
		t.Error("expected empty servers map, got nil")
	}
	if len(cfg.Servers) != 0 {
		t.Errorf("expected 0 servers, got %d", len(cfg.Servers))
	}
}

func TestParseConfigNullServers(t *testing.T) {
	raw := `{"version":1,"servers":null,"defaults":{"readonly_only":true,"fallback_mode":"local_only"}}`
	cfg, err := ParseConfig(raw)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Servers == nil {
		t.Error("expected empty servers map, got nil")
	}
	if len(cfg.Servers) != 0 {
		t.Errorf("expected 0 servers, got %d", len(cfg.Servers))
	}
}

func TestDefaultConfigCanonicalJSON(t *testing.T) {
	canonical, err := CanonicalJSON(DefaultConfig())
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(canonical, `"servers": null`) {
		t.Errorf("expected servers object, got null in %s", canonical)
	}
	if !strings.Contains(canonical, `"servers": {}`) && !strings.Contains(canonical, `"servers": {\n  }`) {
		t.Errorf("expected empty servers object in %s", canonical)
	}
}

func TestParseConfigValid(t *testing.T) {
	raw := `{
	  "version": 1,
	  "servers": {
	    "ctx": {
	      "id": "ctx",
	      "name": "Context",
	      "enabled": true,
	      "transport": "streamable-http",
	      "url": "https://example.com/mcp",
	      "timeout_ms": 15000,
	      "retry": {"max": 1, "backoff_ms": 500},
	      "scope": {"job": true}
	    }
	  },
	  "defaults": {"readonly_only": true, "fallback_mode": "local_only"}
	}`
	cfg, err := ParseConfig(raw)
	if err != nil {
		t.Fatal(err)
	}
	if len(cfg.Servers) != 1 {
		t.Fatalf("servers = %d", len(cfg.Servers))
	}
	if _, ok := cfg.Servers["ctx"]; !ok {
		t.Fatal("expected server ctx")
	}
}

func TestParseConfigLegacyArray(t *testing.T) {
	raw := `{"version":1,"servers":[{"id":"ctx","name":"Context","transport":"streamable-http","url":"https://example.com/mcp"}]}`
	cfg, err := ParseConfig(raw)
	if err != nil {
		t.Fatal(err)
	}
	if len(cfg.Servers) != 1 || cfg.Servers["ctx"].Name != "Context" {
		t.Fatalf("servers = %#v", cfg.Servers)
	}
}

func TestParseConfigInvalidTransport(t *testing.T) {
	raw := `{"version":1,"servers":{"x":{"id":"x","name":"X","transport":"ftp","url":"http://x"}}}`
	_, err := ParseConfig(raw)
	if err == nil {
		t.Fatal("expected error")
	}
	if !strings.Contains(err.Error(), "transport") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestParseConfigWriteToolBlocked(t *testing.T) {
	raw := `{
	  "version": 1,
	  "servers": {
	    "w": {
	      "id": "w",
	      "name": "W",
	      "transport": "streamable-http",
	      "url": "https://example.com/mcp",
	      "allowed_tools": ["create"]
	    }
	  }
	}`
	_, err := ParseConfig(raw)
	if err == nil {
		t.Fatal("expected write tool blocked")
	}
}

func TestParseConfigWriteToolExplicitAllow(t *testing.T) {
	raw := `{
	  "version": 1,
	  "servers": {
	    "w": {
	      "id": "w",
	      "name": "W",
	      "transport": "streamable-http",
	      "url": "https://example.com/mcp",
	      "allowed_tools": ["create"],
	      "allow_write_tools": true
	    }
	  }
	}`
	_, err := ParseConfig(raw)
	if err != nil {
		t.Fatal(err)
	}
}
