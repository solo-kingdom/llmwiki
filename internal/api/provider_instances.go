package api

import (
	"encoding/json"
	"net/http"
	"strings"

	"fmt"

	"github.com/solo-kingdom/llmwiki/internal/activity"
	"github.com/solo-kingdom/llmwiki/internal/store/sqlite"
)

type instanceResponse struct {
	Instance *sqlite.ProviderInstance `json:"instance"`
}

type instanceListResponse struct {
	Instances []sqlite.ProviderInstance `json:"instances"`
}

func (a *API) CreateProviderInstance(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name      string `json:"name"`
		CatalogID string `json:"catalog_id"`
		APIKey    string `json:"api_key"`
		BaseURL   string `json:"base_url"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	req.Name = strings.TrimSpace(req.Name)
	req.CatalogID = strings.TrimSpace(req.CatalogID)
	if req.CatalogID == "" {
		writeError(w, http.StatusBadRequest, "catalog_id is required")
		return
	}

	// Validate catalog_id exists in provider_info_cache
	pInfo, err := a.db.GetProviderInfo(req.CatalogID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if pInfo == nil {
		writeError(w, http.StatusBadRequest, "unknown provider: "+req.CatalogID)
		return
	}

	// Default name to provider display name
	if req.Name == "" {
		req.Name = pInfo.Name
	}

	inst := &sqlite.ProviderInstance{
		Name:      req.Name,
		CatalogID: req.CatalogID,
		APIKey:    req.APIKey,
		BaseURL:   req.BaseURL,
	}
	if err := a.db.CreateProviderInstance(inst); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	// Return instance with masked key
	resp := *inst
	resp.APIKeyMask = maskKey(resp.APIKey)
	resp.APIKey = ""
	activity.Record(a.db, activity.Entry{
		Level:        "info",
		Category:     "provider",
		Action:       "instance_created",
		Message:      fmt.Sprintf("已创建 Provider 实例：%s", resp.Name),
		ResourceType: "provider_instance",
		ResourceID:   resp.ID,
		Status:       "success",
		Source:       "api",
		Details: map[string]interface{}{
			"instance_id": resp.ID,
			"name":        resp.Name,
			"catalog_id":  resp.CatalogID,
		},
	})
	writeJSON(w, http.StatusCreated, instanceResponse{Instance: &resp})
}

func (a *API) ListProviderInstances(w http.ResponseWriter, r *http.Request) {
	instances, err := a.db.ListProviderInstances()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if instances == nil {
		instances = []sqlite.ProviderInstance{}
	}

	// Mask API keys in response
	for i := range instances {
		instances[i].APIKeyMask = maskKey(instances[i].APIKey)
		instances[i].APIKey = ""
	}
	writeJSON(w, http.StatusOK, instanceListResponse{Instances: instances})
}

func (a *API) GetProviderInstance(w http.ResponseWriter, r *http.Request) {
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
	inst.APIKeyMask = maskKey(inst.APIKey)
	inst.APIKey = ""
	writeJSON(w, http.StatusOK, instanceResponse{Instance: inst})
}

func (a *API) UpdateProviderInstanceHandler(w http.ResponseWriter, r *http.Request) {
	id := getID(r)
	existing, err := a.db.GetProviderInstance(id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if existing == nil {
		writeError(w, http.StatusNotFound, "provider instance not found")
		return
	}

	var req struct {
		Name      string `json:"name"`
		CatalogID string `json:"catalog_id"`
		APIKey    string `json:"api_key"`
		BaseURL   string `json:"base_url"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	// Validate catalog_id if changed
	if req.CatalogID != "" && req.CatalogID != existing.CatalogID {
		pInfo, err := a.db.GetProviderInfo(strings.TrimSpace(req.CatalogID))
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		if pInfo == nil {
			writeError(w, http.StatusBadRequest, "unknown provider: "+req.CatalogID)
			return
		}
	}

	if err := a.db.UpdateProviderInstance(id,
		strings.TrimSpace(req.Name),
		strings.TrimSpace(req.CatalogID),
		req.APIKey,
		req.BaseURL,
	); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	updated, _ := a.db.GetProviderInstance(id)
	updated.APIKeyMask = maskKey(updated.APIKey)
	updated.APIKey = ""
	activity.Record(a.db, activity.Entry{
		Level:        "info",
		Category:     "provider",
		Action:       "instance_updated",
		Message:      fmt.Sprintf("已更新 Provider 实例：%s", updated.Name),
		ResourceType: "provider_instance",
		ResourceID:   updated.ID,
		Status:       "success",
		Source:       "api",
		Details: map[string]interface{}{
			"instance_id": updated.ID,
			"name":        updated.Name,
			"catalog_id":  updated.CatalogID,
		},
	})
	writeJSON(w, http.StatusOK, instanceResponse{Instance: updated})
}

func (a *API) DeleteProviderInstanceHandler(w http.ResponseWriter, r *http.Request) {
	id := getID(r)
	existing, _ := a.db.GetProviderInstance(id)
	if err := a.db.DeleteProviderInstance(id); err != nil {
		if strings.Contains(err.Error(), "not found") {
			writeError(w, http.StatusNotFound, err.Error())
			return
		}
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	name := id
	if existing != nil {
		name = existing.Name
	}
	activity.Record(a.db, activity.Entry{
		Level:        "info",
		Category:     "provider",
		Action:       "instance_deleted",
		Message:      fmt.Sprintf("已删除 Provider 实例：%s", name),
		ResourceType: "provider_instance",
		ResourceID:   id,
		Status:       "success",
		Source:       "api",
		Details: map[string]interface{}{
			"instance_id": id,
			"name":        name,
		},
	})
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}
