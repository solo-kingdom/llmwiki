package main

import (
	"fmt"
	"os"

	"github.com/spf13/cobra"
)

// Injected at build time via -ldflags.
var (
	Version   = "dev"
	Commit    = "unknown"
	BuildDate = "unknown"
)

func main() {
	if err := newRootCmd().Execute(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func newRootCmd() *cobra.Command {
	root := &cobra.Command{
		Use:   "llmwiki",
		Short: "LLM Wiki — personal knowledge workspace",
		Long:  "Incrementally build and maintain a structured wiki from source documents.",
	}

	root.AddCommand(newInitCmd())
	root.AddCommand(newServeCmd())
	root.AddCommand(newLintCmd())
	root.AddCommand(newReindexCmd())
	root.AddCommand(newIngestCmd())
	root.AddCommand(newMCPCmd())
	root.AddCommand(newMCPConfigCmd())
	root.AddCommand(newVersionCmd())

	return root
}
