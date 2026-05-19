// Package server provides the HTTP server for LLM Wiki.
package server

import (
	"context"
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
	"github.com/solo-kingdom/llmwiki/internal/store/sqlite"
)

// WebAssets holds the embedded web frontend filesystem.
// Set at build time or left nil for development mode.
var WebAssets fs.FS

// Config holds the server configuration.
type Config struct {
	BindAddr string
	Port     int
	Token    string
	NoMCP    bool
	NoWatch  bool
}

// Server is the LLM Wiki HTTP server.
type Server struct {
	config Config
	http   *http.Server
	db     *sqlite.DB
	api    *api.API
}

// New creates a new Server.
func New(cfg Config, db *sqlite.DB) *Server {
	return &Server{
		config: cfg,
		db:     db,
		api:    api.New(db),
	}
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

	log.Printf("LLM Wiki server starting on http://%s", addr)
	return s.http.ListenAndServe()
}

// Shutdown gracefully stops the server.
func (s *Server) Shutdown(ctx context.Context) error {
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
	w.Write([]byte(`{"status":"ok"}`))
}

func (s *Server) handleWorkspace(w http.ResponseWriter, r *http.Request) {
	http.Error(w, `{"error":"not implemented"}`, http.StatusNotImplemented)
}

func (s *Server) handleReindex(w http.ResponseWriter, r *http.Request) {
	http.Error(w, `{"error":"not implemented"}`, http.StatusNotImplemented)
}
