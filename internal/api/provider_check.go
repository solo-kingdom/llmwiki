package api

import (
	"context"
	"net/http"
	"strings"

	"github.com/solo-kingdom/llmwiki/internal/llm"
	"github.com/solo-kingdom/llmwiki/internal/store/sqlite"
)

type providerCheckResponse struct {
	Status  string               `json:"status"`
	Message string               `json:"message"`
	Details providerCheckDetails `json:"details"`
}

type providerCheckDetails struct {
	HasAPIKey  bool   `json:"has_api_key"`
	HasBaseURL bool   `json:"has_base_url"`
	Reachable  bool   `json:"reachable"`
	CatalogID  string `json:"catalog_id"`
}

// CheckProviderInstance handles POST /api/v1/provider-instances/{id}/check
func (a *API) CheckProviderInstance(w http.ResponseWriter, r *http.Request) {
	id := getID(r)
	inst, err := a.db.GetProviderInstance(id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if inst == nil {
		writeError(w, http.StatusNotFound, "provider instance not found")
		return
	}
	writeJSON(w, http.StatusOK, a.checkProviderInstance(r.Context(), inst))
}

// CheckAllProviderInstances handles POST /api/v1/provider-instances/check
func (a *API) CheckAllProviderInstances(w http.ResponseWriter, r *http.Request) {
	instances, err := a.db.ListProviderInstances()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if instances == nil {
		instances = []sqlite.ProviderInstance{}
	}

	type item struct {
		InstanceID string                `json:"instance_id"`
		Name       string                `json:"name"`
		Check      providerCheckResponse `json:"check"`
	}
	results := make([]item, 0, len(instances))
	ctx := r.Context()
	for _, inst := range instances {
		results = append(results, item{
			InstanceID: inst.ID,
			Name:       inst.Name,
			Check:      a.checkProviderInstance(ctx, &inst),
		})
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"instances": results})
}

func (a *API) checkProviderInstance(ctx context.Context, inst *sqlite.ProviderInstance) providerCheckResponse {
	resp := providerCheckResponse{
		Status:  "ok",
		Message: "连接正常",
		Details: providerCheckDetails{
			HasAPIKey:  strings.TrimSpace(inst.APIKey) != "",
			HasBaseURL: strings.TrimSpace(inst.BaseURL) != "",
			CatalogID:  inst.CatalogID,
		},
	}
	if !resp.Details.HasAPIKey {
		resp.Status = "error"
		resp.Message = "未设置 API Key"
		return resp
	}

	baseURL := inst.BaseURL
	pInfo, _ := a.db.GetProviderInfo(inst.CatalogID)
	if pInfo != nil && baseURL == "" {
		baseURL = pInfo.APIBase
	}
	resp.Details.HasBaseURL = strings.TrimSpace(baseURL) != ""
	if !resp.Details.HasBaseURL {
		resp.Status = "error"
		resp.Message = "未设置 Base URL"
		return resp
	}

	apiFormat := "openai"
	if pInfo != nil && pInfo.APIFormat != "" {
		apiFormat = pInfo.APIFormat
	}

	client := llm.NewClient(llm.Config{
		Provider: apiFormat,
		BaseURL:  baseURL,
		APIKey:   inst.APIKey,
		Model:    "probe",
	})
	if err := client.Probe(ctx); err != nil {
		resp.Status = "error"
		resp.Message = err.Error()
		return resp
	}

	resp.Details.Reachable = true
	return resp
}
