// Package server provides the HTTP server for LLM Wiki.
package server

import (
	"context"
	"encoding/json"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/solo-kingdom/llmwiki/internal/api"
	"github.com/solo-kingdom/llmwiki/internal/ingest"
	"github.com/solo-kingdom/llmwiki/internal/llm"
	"github.com/solo-kingdom/llmwiki/internal/store/sqlite"
	"github.com/solo-kingdom/llmwiki/internal/watcher"
)

// WebAssets holds the embedded web frontend filesystem.
// Set at build time or left nil for development mode.
var WebAssets fs.FS

// Config holds the server configuration.
type Config struct {
	BindAddr  string
	Port      int
	Token     string
	NoMCP     bool
	NoWatch   bool
	Workspace string
	DB        *sqlite.DB
	ConfigMgr *llm.ConfigManager
	LockMgr   *ingest.PageLockManager
}

// Server is the LLM Wiki HTTP server.
// All components (API, Web UI, MCP RPC, watcher) share this single process context.
type Server struct {
	config     Config
	http       *http.Server
	db         *sqlite.DB
	api        *api.API
	mcpHandler http.HandlerFunc
	watcher    *watcher.Watcher
}

// New creates a new Server with shared dependency context.
func New(cfg Config) *Server {
	var configMgr *llm.ConfigManager
	if cfg.ConfigMgr != nil {
		configMgr = cfg.ConfigMgr
	}

	srv := &Server{
		config: cfg,
		db:     cfg.DB,
		api:    api.New(cfg.DB, configMgr),
	}
	if cfg.Workspace != "" {
		srv.api.SetWorkspace(cfg.Workspace)
	}
	if cfg.LockMgr != nil {
		srv.api.SetLockManager(cfg.LockMgr)
	}
	return srv
}

// SetMCPHandler sets the MCP RPC handler (HTTP POST JSON-RPC 2.0).
func (s *Server) SetMCPHandler(h http.HandlerFunc) {
	s.mcpHandler = h
}

// SetWatcher sets the file watcher for automatic index updates.
func (s *Server) SetWatcher(w *watcher.Watcher) {
	s.watcher = w
}

// Start begins listening and serving. Blocks until Shutdown is called.
func (s *Server) Start() error {
	r := chi.NewRouter()

	// Middleware
	r.Use(chimw.RequestID)
	r.Use(chimw.RealIP)
	r.Use(chimw.Logger)
	r.Use(chimw.Recoverer)
	r.Use(chimw.Timeout(60 * time.Second))

	// CORS
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   []string{"*"},
		AllowedMethods:   []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type"},
		ExposedHeaders:   []string{"Link"},
		AllowCredentials: true,
		MaxAge:           300,
	}))

	// Optional token auth
	if s.config.Token != "" {
		r.Use(authMiddleware(s.config.Token))
	}

	// API routes
	r.Route("/api/v1", func(r chi.Router) {
		r.Get("/health", s.handleHealth)
		r.Get("/workspace", s.handleWorkspace)
		r.Post("/reindex", s.handleReindex)

		r.Route("/documents", func(r chi.Router) {
			r.Get("/", s.api.ListDocuments)
			r.Get("/{id}", s.api.GetDocument)
			r.Get("/{id}/content", s.api.GetDocumentContent)
			r.Post("/", s.api.CreateDocument)
			r.Put("/{id}/content", s.api.UpdateDocumentContent)
			r.Patch("/{id}", s.api.UpdateDocumentMetadata)
			r.Delete("/{id}", s.api.DeleteDocument)
			r.Post("/bulk-delete", s.api.BulkDeleteDocuments)
		})

		r.Route("/search", func(r chi.Router) {
			r.Get("/", s.api.Search)
		})

		r.Route("/graph", func(r chi.Router) {
			r.Get("/backlinks/{id}", s.api.Backlinks)
			r.Get("/forward/{id}", s.api.ForwardReferences)
			r.Get("/uncited", s.api.UncitedSources)
			r.Get("/stale", s.api.StalePages)
		})

		r.Get("/settings", s.api.GetSettings)
		r.Put("/settings", s.api.UpdateSettings)
		r.Get("/capabilities", s.api.GetCapabilities)
	})

	// MCP RPC endpoint — JSON-RPC 2.0 over HTTP POST
	if s.mcpHandler != nil {
		r.Post("/mcp", s.mcpHandler)
		log.Println("MCP RPC endpoint enabled at /mcp")
	}

	// SPA fallback
	r.Handle("/*", s.spaHandler())

	addr := fmt.Sprintf("%s:%d", s.config.BindAddr, s.config.Port)
	s.http = &http.Server{
		Addr:         addr,
		Handler:      r,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	// Start watcher in background
	if s.watcher != nil {
		if err := s.watcher.Start(); err != nil {
			log.Printf("Warning: watcher start failed: %v", err)
		}
	}

	log.Printf("LLM Wiki server starting on http://%s (single-process: API + Web + MCP RPC + watcher)", addr)
	return s.http.ListenAndServe()
}

// Shutdown gracefully stops the server and watcher.
func (s *Server) Shutdown(ctx context.Context) error {
	if s.watcher != nil {
		s.watcher.Stop()
	}
	return s.http.Shutdown(ctx)
}

// spaHandler serves the embedded React SPA, falling back to index.html for client-side routing.
func (s *Server) spaHandler() http.HandlerFunc {
	if WebAssets == nil {
		// No web assets embedded — dev mode, serve a placeholder
		return func(w http.ResponseWriter, r *http.Request) {
			if strings.HasPrefix(r.URL.Path, "/api/") {
				http.NotFound(w, r)
				return
			}
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			w.Write([]byte(`<!DOCTYPE html>
<html><head><title>LLM Wiki</title></head>
<body><h1>LLM Wiki</h1><p>Web UI not built. Run <code>make build-web</code> or <code>npm run build</code> in the web/ directory.</p></body>
</html>`))
		}
	}

	fileServer := http.FileServer(http.FS(WebAssets))
	return func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") {
			http.NotFound(w, r)
			return
		}
		// SPA fallback: try the file, if not found, serve index.html
		path := strings.TrimPrefix(r.URL.Path, "/")
		if path == "" {
			path = "index.html"
		}
		f, err := WebAssets.Open(path)
		if err != nil {
			r.URL.Path = "/index.html"
		} else {
			f.Close()
		}
		fileServer.ServeHTTP(w, r)
	}
}

// authMiddleware provides optional token-based authentication.
func authMiddleware(token string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path == "/api/v1/health" {
				next.ServeHTTP(w, r)
				return
			}
			auth := r.Header.Get("Authorization")
			if !strings.HasPrefix(auth, "Bearer ") || strings.TrimPrefix(auth, "Bearer ") != token {
				http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// Handler stubs — placeholders until their respective modules are implemented.

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	mcpEnabled := s.mcpHandler != nil
	watchEnabled := s.watcher != nil

	json.NewEncoder(w).Encode(map[string]interface{}{
		"status": "ok",
		"mode": map[string]interface{}{
			"topology":     "single-process",
			"api_enabled":  true,
			"web_enabled":  true,
			"mcp_enabled":  mcpEnabled,
			"mcp_transport": "rpc-http",
			"watch_enabled": watchEnabled,
		},
		"mcp_access_model": "rpc-first",
		"mcp_compatibility": "First release focuses on RPC access. Direct Claude Desktop stdio connection is not a release gate.",
	})
}

func (s *Server) handleWorkspace(w http.ResponseWriter, r *http.Request) {
	http.Error(w, `{"error":"not implemented"}`, http.StatusNotImplemented)
}

func (s *Server) handleReindex(w http.ResponseWriter, r *http.Request) {
	http.Error(w, `{"error":"not implemented"}`, http.StatusNotImplemented)
}
