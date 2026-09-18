package api

import (
	"encoding/json"
	"net/http"
	"sort"
	"strings"

	"github.com/solo-kingdom/llmwiki/internal/acp"
)

type acpAgentResponse struct {
	acp.RedactedAgent
	Available         bool   `json:"available"`
	UnavailableReason string `json:"unavailable_reason,omitempty"`
}

func (a *API) ListACPAgents(w http.ResponseWriter, r *http.Request) {
	raw, err := a.db.GetConfig("acp_agents_json")
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	cfg, err := acp.ParseConfig(raw)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"agents": []acpAgentResponse{}, "config_error": err.Error()})
		return
	}
	availability := acp.Availability(cfg)
	redacted := acp.RedactedAgents(cfg)
	sort.Slice(redacted, func(i, j int) bool { return redacted[i].ID < redacted[j].ID })
	agents := make([]acpAgentResponse, 0, len(redacted))
	for _, agent := range redacted {
		status := availability[agent.ID]
		agents = append(agents, acpAgentResponse{
			RedactedAgent: agent, Available: status.Available, UnavailableReason: status.Reason,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"agents": agents})
}

func (a *API) CheckACPAgents(w http.ResponseWriter, r *http.Request) {
	raw := ""
	if r.Body != nil && r.ContentLength != 0 {
		var req struct {
			ACPAgentsJSON string `json:"acp_agents_json"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid request body")
			return
		}
		raw = req.ACPAgentsJSON
	}
	if strings.TrimSpace(raw) == "" {
		stored, err := a.db.GetConfig("acp_agents_json")
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		raw = stored
	}
	cfg, err := acp.ParseConfig(raw)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"agents": acp.CheckAgents(r.Context(), cfg, a.workspace)})
}
