package api

import (
	"net/http"
)

type providerResponse struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	APIBase   string `json:"api_base"`
	APIFormat string `json:"api_format"`
	EnvKey    string `json:"env_key"`
	DocURL    string `json:"doc_url"`
}

type modelResponse struct {
	ProviderID   string  `json:"provider_id"`
	ModelID      string  `json:"model_id"`
	Name         string  `json:"name"`
	Family       string  `json:"family"`
	ContextLimit int     `json:"context_limit"`
	OutputLimit  int     `json:"output_limit"`
	CostInput    float64 `json:"cost_input"`
	CostOutput   float64 `json:"cost_output"`
	Reasoning    bool    `json:"reasoning"`
	ToolCall     bool    `json:"tool_call"`
	Attachment   bool    `json:"attachment"`
}

func (a *API) ListProviders(w http.ResponseWriter, r *http.Request) {
	providers, err := a.db.ListProviders()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	result := make([]providerResponse, 0, len(providers))
	for _, p := range providers {
		result = append(result, providerResponse{
			ID:        p.ID,
			Name:      p.Name,
			APIBase:   p.APIBase,
			APIFormat: p.APIFormat,
			EnvKey:    p.EnvKey,
			DocURL:    p.DocURL,
		})
	}
	writeJSON(w, http.StatusOK, result)
}

func (a *API) ListProviderModels(w http.ResponseWriter, r *http.Request) {
	providerID := getID(r)
	if providerID == "" {
		writeError(w, http.StatusBadRequest, "provider id is required")
		return
	}

	models, err := a.db.ListModelsByProvider(providerID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	result := make([]modelResponse, 0, len(models))
	for _, m := range models {
		result = append(result, modelResponse{
			ProviderID:   m.ProviderID,
			ModelID:      m.ModelID,
			Name:         m.Name,
			Family:       m.Family,
			ContextLimit: m.ContextLimit,
			OutputLimit:  m.OutputLimit,
			CostInput:    m.CostInput,
			CostOutput:   m.CostOutput,
			Reasoning:    m.Reasoning,
			ToolCall:     m.ToolCall,
			Attachment:   m.Attachment,
		})
	}
	writeJSON(w, http.StatusOK, result)
}
