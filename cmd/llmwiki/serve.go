package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/spf13/cobra"
	_ "github.com/solo-kingdom/llmwiki" // embed web assets
	"github.com/solo-kingdom/llmwiki/internal/ingest"
	"github.com/solo-kingdom/llmwiki/internal/llm"
	"github.com/solo-kingdom/llmwiki/internal/mcp"
	"github.com/solo-kingdom/llmwiki/internal/server"
	storesvc "github.com/solo-kingdom/llmwiki/internal/store"
	"github.com/solo-kingdom/llmwiki/internal/store/sqlite"
	"github.com/solo-kingdom/llmwiki/internal/vcs"
	"github.com/solo-kingdom/llmwiki/internal/watcher"
)

func newServeCmd() *cobra.Command {
	var (
		bindAddr   string
		port       int
		token      string
		publicWiki bool
		noMCP      bool
		noWatch    bool
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
				bindAddr:   bindAddr,
				port:       port,
				token:      token,
				publicWiki: publicWiki,
				noMCP:      noMCP,
				noWatch:    noWatch,
			})
		},
	}

	cmd.Flags().StringVar(&bindAddr, "bind", "127.0.0.1", "Bind address")
	cmd.Flags().IntVar(&port, "port", 8868, "HTTP port")
	cmd.Flags().StringVar(&token, "token", "", "API token for authentication (optional)")
	cmd.Flags().BoolVar(&publicWiki, "public-wiki", false, "Enable public read-only Wiki at /wiki and /api/public/wiki/*")
	cmd.Flags().BoolVar(&noMCP, "no-mcp", false, "Disable MCP server")
	cmd.Flags().BoolVar(&noWatch, "no-watch", false, "Disable file watcher")

	return cmd
}

type serveOptions struct {
	bindAddr   string
	port       int
	token      string
	publicWiki bool
	noMCP      bool
	noWatch    bool
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

	lockMgr := ingest.NewPageLockManager()
	srv := server.New(server.Config{
		BindAddr:   opts.bindAddr,
		Port:       opts.port,
		Token:      opts.token,
		PublicWiki: opts.publicWiki,
		NoMCP:      opts.noMCP,
		NoWatch:    opts.noWatch,
		Workspace:  ws,
		DB:         db,
		LockMgr:    lockMgr,
	})

	if !opts.noMCP {
		mcpServer := mcp.NewServer("LLM Wiki",
			"You are connected to an LLM Wiki workspace. Call the `guide` tool first to see available knowledge bases and learn the full workflow.",
		)
		mcp.RegisterTools(mcpServer, ws, db)
		srv.SetMCPHandler(mcp.NewHTTPHandler(mcpServer))
	}

	if !opts.noWatch {
		w, err := watcher.New(ws, nil)
		if err != nil {
			log.Printf("Warning: file watcher unavailable: %v", err)
		} else {
			srv.SetWatcher(w)
		}
	}

	wsCfg, err := llm.LoadConfig(ws)
	if err != nil {
		log.Printf("Warning: load LLM config: %v", err)
	}
	llmClient := llm.NewClient(llm.Config{
		Provider:          wsCfg.Provider,
		BaseURL:           wsCfg.BaseURL,
		APIKey:            wsCfg.APIKey,
		Model:             wsCfg.Model,
		Timeout:           time.Duration(wsCfg.RequestTimeout) * time.Second,
		StreamIdleTimeout: time.Duration(wsCfg.StreamIdleTimeout) * time.Second,
	})

	processor := ingest.NewJobProcessor(db, ws, llmClient)
	gitRepo := vcs.NewGitRepo(ws)
	if gitRepo.IsInitialized() {
		processor.SetGitRepo(gitRepo)
	}
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
