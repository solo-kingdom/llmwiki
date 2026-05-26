package api

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/solo-kingdom/llmwiki/internal/mcp"
)

type mcpCheckResponse struct {
	Servers []mcp.ServerCheckResult `json:"servers"`
}

// CheckMCPStatus handles POST /api/v1/settings/mcp/check.
// Optional body: { "mcp_servers_json": "..." } to probe unsaved config.
func (a *API) CheckMCPStatus(w http.ResponseWriter, r *http.Request) {
	raw := ""
	if r.Body != nil && r.ContentLength != 0 {
		var req struct {
			MCPServersJSON string `json:"mcp_servers_json"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid request body")
			return
		}
		raw = req.MCPServersJSON
	}
	if strings.TrimSpace(raw) == "" {
		stored, err := a.db.GetConfig("mcp_servers_json")
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		raw = stored
	}

	cfg, err := mcp.ParseConfig(raw)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, mcpCheckResponse{
		Servers: mcp.CheckServers(r.Context(), cfg),
	})
}
