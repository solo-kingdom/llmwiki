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
	"github.com/solo-kingdom/llmwiki/internal/activity"
	"github.com/solo-kingdom/llmwiki/internal/api"
	"github.com/solo-kingdom/llmwiki/internal/engine"
	"github.com/solo-kingdom/llmwiki/internal/ingest"
	"github.com/solo-kingdom/llmwiki/internal/llm"
	storesvc "github.com/solo-kingdom/llmwiki/internal/store"
	"github.com/solo-kingdom/llmwiki/internal/store/sqlite"
	"github.com/solo-kingdom/llmwiki/internal/watcher"
)

// WebAssets holds the embedded web frontend filesystem.
// Set at build time or left nil for development mode.
var WebAssets fs.FS

// Config holds the server configuration.
type Config struct {
	BindAddr    string
	Port        int
	Token       string
	PublicWiki  bool
	NoMCP       bool
	NoWatch     bool
	Workspace   string
	DB          *sqlite.DB
	LockMgr     *ingest.PageLockManager
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
	srv := &Server{
		config: cfg,
		db:     cfg.DB,
		api:    api.New(cfg.DB),
	}
	if cfg.Workspace != "" {
		srv.api.SetWorkspace(cfg.Workspace)
	}
	if cfg.LockMgr != nil {
		srv.api.SetLockManager(cfg.LockMgr)
	}
	srv.api.SetPublicWikiEnabled(cfg.PublicWiki)
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

// SetFileIndexer sets the workspace file indexer for API-driven search updates.
func (s *Server) SetFileIndexer(indexer *engine.WorkspaceFileIndexer) {
	s.api.SetFileIndexer(indexer)
}

// Start begins listening and serving. Blocks until Shutdown is called.
func (s *Server) Start() error {
	activity.Start()
	if s.db != nil {
		activity.RecordSync(s.db, activity.Entry{
			Level:    "info",
			Category: "system",
			Action:   "server_started",
			Message:  "LLM Wiki 服务已启动",
			Source:   "processor",
		})
		go s.startActivityLogsTrimLoop()
	}

	// Start provider/model data sync from models.dev in background
	s.startProviderSync()

	r := chi.NewRouter()

	// Middleware
	r.Use(chimw.RequestID)
	r.Use(chimw.RealIP)
	r.Use(chimw.Logger)
	r.Use(chimw.Recoverer)
	r.Use(timeoutUnlessStream(60 * time.Second))

	// CORS
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   []string{"*"},
		AllowedMethods:   []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type"},
		ExposedHeaders:   []string{"Link"},
		AllowCredentials: true,
		MaxAge:           300,
	}))

	// Public wiki read-only API (no management token required when enabled)
	r.Route("/api/public/wiki", func(r chi.Router) {
		r.Get("/status", s.api.PublicWikiStatus)
		r.Get("/documents", s.api.ListPublicWikiDocuments)
		r.Get("/documents/{id}", s.api.GetPublicWikiDocument)
		r.Get("/search", s.api.SearchPublicWiki)
	})

	// Optional token auth for management APIs
	if s.config.Token != "" {
		r.Use(authMiddleware(s.config.Token, s.config.PublicWiki))
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
		r.Put("/settings/last-model", s.api.UpdateLastModel)
		r.Get("/logs", s.api.ListActivityLogsHandler)
		r.Delete("/logs", s.api.DeleteAllActivityLogsHandler)
		r.Get("/capabilities", s.api.GetCapabilities)

		// Version Control
		r.Post("/vcs/init", s.api.VCSInit)
		r.Get("/vcs/status", s.api.VCSStatus)
		r.Post("/vcs/disable", s.api.VCSDisable)
		r.Get("/vcs/log", s.api.VCSLog)
		r.Get("/vcs/diff/{sha}", s.api.VCSDiff)

		r.Get("/providers", s.api.ListProviders)
		r.Get("/providers/{id}/models", s.api.ListProviderModels)

		r.Route("/provider-instances", func(r chi.Router) {
			r.Get("/", s.api.ListProviderInstances)
			r.Post("/", s.api.CreateProviderInstance)
			r.Get("/{id}", s.api.GetProviderInstance)
			r.Put("/{id}", s.api.UpdateProviderInstanceHandler)
			r.Delete("/{id}", s.api.DeleteProviderInstanceHandler)
		})

		r.Route("/ingest", func(r chi.Router) {
			r.Post("/rollback", s.api.VCSRollback)
			r.Route("/sessions", func(r chi.Router) {
				r.Get("/", s.api.ListIngestSessionsHandler)
				r.Post("/", s.api.CreateIngestSession)
				r.Get("/{id}", s.api.GetIngestSession)
				r.Patch("/{id}", s.api.UpdateIngestSessionHandler)
				r.Delete("/{id}", s.api.DeleteIngestSessionHandler)
				r.Get("/{id}/messages", s.api.ListIngestSessionMessages)
				r.Post("/{id}/messages", s.api.AppendIngestSessionMessage)
				r.Post("/{id}/attachments", s.api.UploadIngestSessionAttachment)
				r.Post("/{id}/archive", s.api.ArchiveIngestSession)
			})
			r.Route("/jobs", func(r chi.Router) {
				r.Get("/", s.api.ListIngestJobs)
				r.Get("/{id}/events", s.api.GetIngestJobEvents)
				r.Get("/{id}", s.api.GetIngestJob)
				r.Get("/{id}/source", s.api.GetJobSource)
				r.Post("/{id}/retry", s.api.RetryIngestJob)
				r.Post("/{id}/cancel", s.api.CancelIngestJob)
				r.Post("/{id}/fail", s.api.MarkIngestJobFailed)
				r.Post("/conversation", s.api.CreateConversationIngestJob)
				r.Post("/text", s.api.CreateTextIngestJob)
				r.Post("/upload", s.api.CreateUploadIngestJobs)
			})
		})
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
		WriteTimeout: 0, // allow long-lived SSE streams; per-request limits use LLM client timeouts
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

	indexHTML, err := fs.ReadFile(WebAssets, "index.html")
	if err != nil {
		log.Printf("Warning: index.html missing in embedded web assets: %v", err)
	}

	fileServer := http.FileServer(http.FS(WebAssets))
	serveIndex := func(w http.ResponseWriter, r *http.Request) {
		if indexHTML == nil {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write(indexHTML)
	}

	return func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") {
			http.NotFound(w, r)
			return
		}

		path := strings.TrimPrefix(r.URL.Path, "/")
		if path == "" {
			serveIndex(w, r)
			return
		}

		f, err := WebAssets.Open(path)
		if err == nil {
			f.Close()
			fileServer.ServeHTTP(w, r)
			return
		}

		// Client-side route (e.g. /jobs, /wiki): return index.html without FileServer redirects.
		serveIndex(w, r)
	}
}

// timeoutUnlessStream applies chi timeout to normal requests but skips ingest SSE streams.
func timeoutUnlessStream(d time.Duration) func(http.Handler) http.Handler {
	short := chimw.Timeout(d)
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if isIngestSessionStream(r) {
				next.ServeHTTP(w, r)
				return
			}
			short(next).ServeHTTP(w, r)
		})
	}
}

func isIngestSessionStream(r *http.Request) bool {
	if r.Method != http.MethodPost {
		return false
	}
	if !strings.Contains(r.URL.Path, "/ingest/sessions/") {
		return false
	}
	if !strings.HasSuffix(r.URL.Path, "/messages") {
		return false
	}
	return r.URL.Query().Get("stream") == "1" ||
		strings.Contains(r.Header.Get("Accept"), "text/event-stream")
}

// authMiddleware provides optional token-based authentication.
func authMiddleware(token string, publicWiki bool) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path == "/api/v1/health" || r.URL.Path == "/api/public/wiki/status" {
				next.ServeHTTP(w, r)
				return
			}
			if publicWiki && strings.HasPrefix(r.URL.Path, "/api/public/wiki/") {
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
			"topology":      "single-process",
			"api_enabled":   true,
			"web_enabled":   true,
			"mcp_enabled":   mcpEnabled,
			"mcp_transport": "rpc-http",
			"watch_enabled": watchEnabled,
		},
		"mcp_access_model":  "rpc-first",
		"mcp_compatibility": "First release focuses on RPC access. Direct Claude Desktop stdio connection is not a release gate.",
	})
}

func (s *Server) handleWorkspace(w http.ResponseWriter, r *http.Request) {
	http.Error(w, `{"error":"not implemented"}`, http.StatusNotImplemented)
}

func (s *Server) handleReindex(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}
	if s.db == nil || s.config.Workspace == "" {
		http.Error(w, `{"error":"workspace not configured"}`, http.StatusInternalServerError)
		return
	}

	beforeCount, _ := s.db.CountActivityLogs("", "")

	activity.Record(s.db, activity.Entry{
		Level:    "info",
		Category: "system",
		Action:   "reindex_started",
		Message:  "开始重建索引",
		Source:   "api",
	})

	adapter := storesvc.NewStoreAdapter(s.db)
	reindexer := engine.NewReindexer(adapter, s.config.Workspace)
	count, err := reindexer.Rebuild("default")
	if err != nil {
		activity.Record(s.db, activity.Entry{
			Level:    "error",
			Category: "system",
			Action:   "reindex_completed",
			Message:  fmt.Sprintf("索引重建失败：%v", err),
			Status:   "failure",
			Source:   "api",
			Details: map[string]interface{}{
				"error": err.Error(),
			},
		})
		http.Error(w, fmt.Sprintf(`{"error":%q}`, err.Error()), http.StatusInternalServerError)
		return
	}

	afterCount, _ := s.db.CountActivityLogs("", "")
	activity.Record(s.db, activity.Entry{
		Level:    "info",
		Category: "system",
		Action:   "reindex_completed",
		Message:  fmt.Sprintf("索引重建完成，共索引 %d 个文件", count),
		Status:   "success",
		Source:   "api",
		Details: map[string]interface{}{
			"indexed_count":      count,
			"activity_logs_kept": afterCount == beforeCount,
		},
	})

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"indexed": count,
		"status":  "ok",
	})
}

func (s *Server) startActivityLogsTrimLoop() {
	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()
	for range ticker.C {
		if s.db == nil {
			continue
		}
		if _, err := s.api.TrimActivityLogsScheduled(); err != nil {
			log.Printf("activity logs trim: %v", err)
		}
	}
}

// startProviderSync loads the built-in snapshot, then kicks off background
// sync from models.dev. Runs as goroutines — does not block server startup.
func (s *Server) startProviderSync() {
	if s.db == nil {
		return
	}

	// Load built-in snapshot if cache is empty
	go func() {
		empty, err := s.db.CacheIsEmpty()
		if err != nil {
			log.Printf("provider cache check: %v", err)
			return
		}
		if empty {
			pInfo, mInfo, err := llm.LoadSnapshot()
			if err != nil {
				log.Printf("load provider snapshot: %v", err)
				return
			}
			if len(pInfo) > 0 {
				if err := s.db.UpsertProviderInfo(pInfo); err != nil {
					log.Printf("write snapshot providers: %v", err)
				}
			}
			if len(mInfo) > 0 {
				if err := s.db.UpsertModels(mInfo); err != nil {
					log.Printf("write snapshot models: %v", err)
				}
			}
			log.Printf("loaded built-in snapshot: %d providers, %d models", len(pInfo), len(mInfo))
		}
	}()

	// Sync from models.dev in background (non-blocking)
	go func() {
		ctx := context.Background()
		if err := llm.SyncModelsDev(ctx, s.db); err != nil {
			log.Printf("models.dev sync failed (will retry later): %v", err)
			activity.Record(s.db, activity.Entry{
				Level:    "warn",
				Category: "system",
				Action:   "models_sync_failed",
				Message:  "models.dev 同步失败",
				Status:   "failure",
				Source:   "processor",
				Details: map[string]interface{}{
					"error": err.Error(),
				},
			})
		}

		// Periodic sync every hour
		ticker := time.NewTicker(1 * time.Hour)
		defer ticker.Stop()
		for range ticker.C {
			if err := llm.SyncModelsDev(ctx, s.db); err != nil {
				log.Printf("models.dev periodic sync failed: %v", err)
				activity.Record(s.db, activity.Entry{
					Level:    "warn",
					Category: "system",
					Action:   "models_sync_failed",
					Message:  "models.dev 定期同步失败",
					Status:   "failure",
					Source:   "processor",
					Details: map[string]interface{}{
						"error": err.Error(),
					},
				})
			}
		}
	}()
}
