package llmwiki

import (
	"embed"
	"io/fs"

	"github.com/solo-kingdom/llmwiki/internal/server"
)

//go:embed all:web/dist
var webAssets embed.FS

func init() {
	sub, err := fs.Sub(webAssets, "web/dist")
	if err != nil {
		return
	}
	if f, err := sub.Open("index.html"); err == nil {
		f.Close()
		server.WebAssets = sub
	}
}
