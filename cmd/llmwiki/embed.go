package main

import (
	"context"
	"fmt"
	"os"
	"time"

	"github.com/spf13/cobra"

	"github.com/solo-kingdom/llmwiki/internal/llm"
	"github.com/solo-kingdom/llmwiki/internal/store"
)

func newEmbedCmd() *cobra.Command {
	var batch int
	cmd := &cobra.Command{
		Use:   "embed",
		Short: "Backfill chunk embeddings with the configured embedding model",
		RunE: func(cmd *cobra.Command, args []string) error {
			return runEmbed(batch)
		},
	}
	cmd.Flags().IntVar(&batch, "batch", 32, "Chunks per embedding request")
	return cmd
}

func runEmbed(batch int) error {
	if batch <= 0 {
		batch = 32
	}
	db, err := openDatabase()
	if err != nil {
		return err
	}
	defer db.Close()

	client, settings, err := llm.EmbeddingClient(db)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Hour)
	defer cancel()

	total := 0
	for {
		chunks, err := db.ChunksMissingEmbedding(settings.Model, batch)
		if err != nil {
			return fmt.Errorf("load chunks: %w", err)
		}
		if len(chunks) == 0 {
			break
		}
		inputs := make([]string, len(chunks))
		for i, c := range chunks {
			inputs[i] = c.Content
		}
		vectors, err := client.Embeddings(ctx, settings.Model, inputs)
		if err != nil {
			return fmt.Errorf("embed %d chunk(s): %w", len(chunks), err)
		}
		embeddings := make([]store.ChunkEmbedding, 0, len(chunks))
		for i, c := range chunks {
			dim := len(vectors[i])
			if settings.Dim > 0 && dim != settings.Dim {
				return fmt.Errorf("embedding dimension mismatch: got %d, configured %d", dim, settings.Dim)
			}
			embeddings = append(embeddings, store.ChunkEmbedding{
				ChunkID:   c.ID,
				Model:     settings.Model,
				Dim:       dim,
				Embedding: vectors[i],
			})
		}
		if err := db.StoreChunkEmbeddings(embeddings); err != nil {
			return fmt.Errorf("store embeddings: %w", err)
		}
		total += len(embeddings)
		fmt.Fprintf(os.Stderr, "embedded %d chunk(s)\n", total)
	}
	fmt.Printf("Embedded %d chunk(s) with %s\n", total, settings.Model)
	return nil
}
