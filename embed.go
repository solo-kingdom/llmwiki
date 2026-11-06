package llmwiki

import (
	"embed"
	"io/fs"

	"github.com/solo-kingdom/llmwiki/internal/server"
)

//go:embed all:web/dist
var webAssets embed.FS

//go:embed all:skills
var skillAssets embed.FS

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

func init() {
	// Skills travel with the binary so /skill.md works without a source checkout.
	sub, err := fs.Sub(skillAssets, "skills")
	if err != nil {
		return
	}
	server.SkillAssets = sub
}
