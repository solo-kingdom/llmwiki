package main

import (
	"context"
	"fmt"
	"log"
	"net"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"syscall"
	"time"

	_ "github.com/solo-kingdom/llmwiki" // embed web assets
	"github.com/solo-kingdom/llmwiki/internal/acp"
	"github.com/solo-kingdom/llmwiki/internal/activity"
	"github.com/solo-kingdom/llmwiki/internal/engine"
	"github.com/solo-kingdom/llmwiki/internal/ingest"
	"github.com/solo-kingdom/llmwiki/internal/mcp"
	"github.com/solo-kingdom/llmwiki/internal/server"
	storesvc "github.com/solo-kingdom/llmwiki/internal/store"
	"github.com/solo-kingdom/llmwiki/internal/store/sqlite"
	"github.com/solo-kingdom/llmwiki/internal/watcher"
	"github.com/solo-kingdom/llmwiki/internal/workspace"
	"github.com/spf13/cobra"
)

func newServeCmd() *cobra.Command {
	var (
		bindAddr      string
		port          int
		token         string
		publicWiki    bool
		noMCP         bool
		noWatch       bool
		mcpAllowWrite bool
	)

	cmd := &cobra.Command{
		Use:   "serve [dir]",
		Short: "Start the HTTP API server with embedded web UI",
		Args:  cobra.MaximumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			dir := ""
			if len(args) > 0 {
				dir = args[0]
			}
			return runServe(dir, serveOptions{
				bindAddr:      bindAddr,
				port:          port,
				token:         token,
				publicWiki:    publicWiki,
				noMCP:         noMCP,
				noWatch:       noWatch,
				mcpAllowWrite: mcpAllowWrite,
			})
		},
	}

	cmd.Flags().StringVar(&bindAddr, "bind", "127.0.0.1", "Bind address")
	cmd.Flags().IntVar(&port, "port", 8868, "HTTP port")
	cmd.Flags().StringVar(&token, "token", "", "API token for authentication (optional)")
	cmd.Flags().BoolVar(&publicWiki, "public-wiki", false, "Enable public read-only Wiki at /wiki and /api/public/wiki/*")
	cmd.Flags().BoolVar(&noMCP, "no-mcp", false, "Disable MCP server")
	cmd.Flags().BoolVar(&noWatch, "no-watch", false, "Disable file watcher")
	cmd.Flags().BoolVar(&mcpAllowWrite, "mcp-allow-write", false, "Allow MCP write/delete tools for remote agents (default: readonly)")

	return cmd
}

type serveOptions struct {
	bindAddr      string
	port          int
	token         string
	publicWiki    bool
	noMCP         bool
	noWatch       bool
	mcpAllowWrite bool
}

func runServe(dir string, opts serveOptions) error {
	ws, err := resolveWorkspaceDir(dir)
	if err != nil {
		return err
	}

	dbPath, _, err := storesvc.DiscoverWorkspace(ws)
	if err != nil {
		return err
	}

	db, err := sqlite.Open(dbPath)
	if err != nil {
		return fmt.Errorf("open database: %w", err)
	}
	defer db.Close()

	if err := workspace.ImportSettingsIfEmpty(db, ws); err != nil {
		return fmt.Errorf("import workspace settings: %w", err)
	}
	acp.Version = Version
	maxConcurrent := acp.DefaultMaxConcurrentAgents
	if raw, err := db.GetConfig("acp_max_concurrent_agents"); err == nil && raw != "" {
		if n, parseErr := strconv.Atoi(raw); parseErr == nil && n >= acp.MinConcurrentAgents && n <= acp.MaxConcurrentAgents {
			maxConcurrent = n
		}
	}
	acpManager := acp.NewManager(maxConcurrent)
	defer acpManager.CloseAll()

	// Remote MCP security: non-loopback bind with MCP enabled requires token.
	if !opts.noMCP && !isLoopback(opts.bindAddr) && opts.token == "" {
		return fmt.Errorf("remote MCP security: --token is required when binding to non-loopback address %q.\nUse --no-mcp to disable MCP or set --token <secret>", opts.bindAddr)
	}

	lockMgr := ingest.NewPageLockManager()
	srv := server.New(server.Config{
		BindAddr:      opts.bindAddr,
		Port:          opts.port,
		Token:         opts.token,
		PublicWiki:    opts.publicWiki,
		NoMCP:         opts.noMCP,
		NoWatch:       opts.noWatch,
		Workspace:     ws,
		DB:            db,
		LockMgr:       lockMgr,
		MCPAllowWrite: opts.mcpAllowWrite,
		ACPManager:    acpManager,
	})

	adapter := storesvc.NewStoreAdapter(db)
	fileIndexer := engine.NewWorkspaceFileIndexer(adapter, ws)
	srv.SetFileIndexer(fileIndexer)

	if !opts.noMCP {
		mcpServer := mcp.NewServer("LLM Wiki",
			"You are connected to an LLM Wiki workspace. Call the `guide` tool first to see available knowledge bases and learn the full workflow.",
		)
		mcp.RegisterTools(mcpServer, ws, db, fileIndexer)
		mcpServer.SetToolPolicy(mcp.DefaultToolPolicy(opts.mcpAllowWrite))
		mcpServer.SetAuditDB(mcp.NewAuditAdapter(db))
		srv.SetMCPHandler(mcp.NewHTTPHandler(mcpServer))
	}

	if !opts.noWatch {
		w, err := watcher.New(ws, func(changes []watcher.Change) {
			for _, ch := range changes {
				rel, err := filepath.Rel(ws, ch.Path)
				if err != nil {
					continue
				}
				rel = filepath.ToSlash(rel)
				switch ch.Type {
				case watcher.ChangeCreated:
					activity.RecordWatcherEvent(db, "file_created", rel)
				case watcher.ChangeModified:
					activity.RecordWatcherModify(db, rel)
				case watcher.ChangeDeleted:
					activity.RecordWatcherEvent(db, "file_deleted", rel)
				}
			}
		})
		if err != nil {
			log.Printf("Warning: file watcher unavailable: %v", err)
		} else {
			w.SetIndexer(&activity.Indexer{Inner: fileIndexer, DB: db})
			srv.SetWatcher(w)
		}
	}

	processor := ingest.NewJobProcessor(db, ws)
	processor.SetFileIndexer(fileIndexer)
	processor.Start(2 * time.Second)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	errCh := make(chan error, 1)
	go func() {
		errCh <- srv.Start()
	}()

	select {
	case <-ctx.Done():
		log.Println("Shutting down...")
		processor.Stop()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := srv.Shutdown(shutdownCtx); err != nil {
			return fmt.Errorf("shutdown: %w", err)
		}
		return nil
	case err := <-errCh:
		processor.Stop()
		if err != nil {
			return err
		}
		return nil
	}
}

// isLoopback reports whether the bind address is a loopback address.
func isLoopback(addr string) bool {
	if addr == "localhost" || addr == "127.0.0.1" || addr == "::1" {
		return true
	}
	ip := net.ParseIP(addr)
	if ip != nil {
		return ip.IsLoopback()
	}
	return false
}
