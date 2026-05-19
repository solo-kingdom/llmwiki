package api

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"strings"
	"time"

	"github.com/solo-kingdom/llmwiki/internal/ingest"
	"github.com/solo-kingdom/llmwiki/internal/llm"
	"github.com/solo-kingdom/llmwiki/internal/store/sqlite"
)

type createSessionRequest struct {
	Title string `json:"title"`
}

type appendMessageRequest struct {
	Content string `json:"content"`
}

type archiveSessionRequest struct {
	Title string `json:"title"`
}

type sessionResponse struct {
	Session *sqlite.IngestSession `json:"session"`
}

type messagesResponse struct {
	Messages []sqlite.IngestSessionMessage `json:"messages"`
}

type messageResponse struct {
	Message *sqlite.IngestSessionMessage `json:"message"`
}

type archiveResponse struct {
	JobID       string `json:"job_id"`
	SourcePath  string `json:"source_path"`
	SessionID   string `json:"session_id"`
}

func (a *API) CreateIngestSession(w http.ResponseWriter, r *http.Request) {
	if !a.requireWorkspaceForIngest(w) {
		return
	}
	var req struct {
		Title    string `json:"title"`
		Provider string `json:"provider"`
		Model    string `json:"model"`
	}
	if r.Body != nil {
		_ = json.NewDecoder(r.Body).Decode(&req)
	}

	// Read provider/model: request overrides, fallback to global defaults
	provider := req.Provider
	model := req.Model
	if provider == "" {
		provider, _ = a.db.GetConfig("last_provider")
	}
	if model == "" {
		model, _ = a.db.GetConfig("last_model")
	}

	session := &sqlite.IngestSession{
		Title:       strings.TrimSpace(req.Title),
		Status:      "active",
		LLMProvider: provider,
		LLMModel:    model,
	}
	if err := a.db.CreateIngestSession(session); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	rel, err := ingest.EnsureSessionDirs(a.workspace, session.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	session.StoragePath = rel
	_ = a.db.UpdateIngestSessionStoragePath(session.ID, rel)
	_ = a.db.UpdateIngestSessionTitle(session.ID, session.Title)
	writeJSON(w, http.StatusCreated, sessionResponse{Session: session})
}

func (a *API) GetIngestSession(w http.ResponseWriter, r *http.Request) {
	id := getID(r)
	session, err := a.db.GetIngestSession(id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if session == nil {
		writeError(w, http.StatusNotFound, "session not found")
		return
	}
	writeJSON(w, http.StatusOK, sessionResponse{Session: session})
}

func (a *API) ListIngestSessionMessages(w http.ResponseWriter, r *http.Request) {
	id := getID(r)
	session, err := a.db.GetIngestSession(id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if session == nil {
		writeError(w, http.StatusNotFound, "session not found")
		return
	}
	msgs, err := a.db.ListIngestSessionMessages(id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if msgs == nil {
		msgs = []sqlite.IngestSessionMessage{}
	}
	writeJSON(w, http.StatusOK, messagesResponse{Messages: msgs})
}

func (a *API) AppendIngestSessionMessage(w http.ResponseWriter, r *http.Request) {
	sessionID := getID(r)
	if !a.requireWorkspaceForIngest(w) {
		return
	}
	session, err := a.loadSession(sessionID, w)
	if err != nil || session == nil {
		return
	}
	var req appendMessageRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if strings.TrimSpace(req.Content) == "" {
		writeError(w, http.StatusBadRequest, "content is required")
		return
	}

	stream := r.URL.Query().Get("stream") == "1" || strings.Contains(r.Header.Get("Accept"), "text/event-stream")
	if stream {
		a.streamSessionReply(w, r, session, req.Content)
		return
	}

	userMsg := &sqlite.IngestSessionMessage{
		SessionID:    sessionID,
		Role:         "user",
		Content:      req.Content,
		MessageType:  "text",
		StreamStatus: "complete",
	}
	if err := a.db.CreateIngestSessionMessage(userMsg); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, messageResponse{Message: userMsg})
}

func (a *API) streamSessionReply(w http.ResponseWriter, r *http.Request, session *sqlite.IngestSession, userContent string) {
	client, provider, model := a.sessionLLMClient(session)
	if client == nil {
		if provider == "" || model == "" {
			writeError(w, http.StatusBadRequest, "请先选择 Provider 和 Model")
		} else {
			writeError(w, http.StatusBadRequest, "请先配置 "+provider+" 的 API Key")
		}
		return
	}

	history, err := a.db.ListIngestSessionMessages(session.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	userMsg := &sqlite.IngestSessionMessage{
		SessionID:    session.ID,
		Role:         "user",
		Content:      userContent,
		MessageType:  "text",
		StreamStatus: "complete",
	}
	if err := a.db.CreateIngestSessionMessage(userMsg); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	assistantMsg := &sqlite.IngestSessionMessage{
		SessionID:    session.ID,
		Role:         "assistant",
		Content:      "",
		MessageType:  "text",
		StreamStatus: "streaming",
	}
	if err := a.db.CreateIngestSessionMessage(assistantMsg); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	flusher, ok := w.(http.Flusher)
	if !ok {
		writeError(w, http.StatusInternalServerError, "streaming not supported")
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.WriteHeader(http.StatusOK)

	sendEvent := func(eventType string, payload interface{}) {
		data, _ := json.Marshal(payload)
		fmt.Fprintf(w, "event: %s\ndata: %s\n\n", eventType, data)
		flusher.Flush()
	}

	sendEvent("user_message", userMsg)
	sendEvent("assistant_start", map[string]string{"id": assistantMsg.ID})

	msgs := ingest.AssembleIngestChatMessages(history, userContent)
	ctx := r.Context()
	ch, err := client.StreamChat(ctx, msgs, 0.7, 2048)
	if err != nil {
		_ = a.db.UpdateIngestSessionMessageContent(assistantMsg.ID, "", "failed")
		sendEvent("error", map[string]string{"message": err.Error()})
		return
	}

	var builder strings.Builder
	streamStatus := "complete"
	for ev := range ch {
		switch ev.Type {
		case "token":
			builder.WriteString(ev.Content)
			sendEvent("token", map[string]string{"content": ev.Content})
		case "error":
			streamStatus = "failed"
			if ev.Error != nil {
				sendEvent("error", map[string]string{"message": ev.Error.Error()})
			}
		}
	}
	if streamStatus == "complete" && builder.Len() == 0 {
		streamStatus = "incomplete"
	}
	content := builder.String()
	_ = a.db.UpdateIngestSessionMessageContent(assistantMsg.ID, content, streamStatus)
	assistantMsg.Content = content
	assistantMsg.StreamStatus = streamStatus
	sendEvent("done", assistantMsg)
}

func (a *API) UploadIngestSessionAttachment(w http.ResponseWriter, r *http.Request) {
	sessionID := getID(r)
	if !a.requireWorkspaceForIngest(w) {
		return
	}
	session, err := a.loadSession(sessionID, w)
	if err != nil || session == nil {
		return
	}
	if err := r.ParseMultipartForm(64 << 20); err != nil {
		writeError(w, http.StatusBadRequest, "invalid multipart form")
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		files := r.MultipartForm.File["files"]
		if len(files) > 0 {
			fh := files[0]
			file, err = fh.Open()
			if err != nil {
				writeError(w, http.StatusBadRequest, "cannot open file")
				return
			}
			defer file.Close()
			header = fh
		} else {
			writeError(w, http.StatusBadRequest, "file is required")
			return
		}
	} else {
		defer file.Close()
	}

	data, err := io.ReadAll(file)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	attID, relPath, err := ingest.WriteSessionAttachment(a.workspace, sessionID, header.Filename, data)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	summary := a.summarizeAttachment(r.Context(), header.Filename, relPath, data)
	msg := &sqlite.IngestSessionMessage{
		SessionID:    sessionID,
		Role:         "assistant",
		Content:      summary,
		MessageType:  "attachment_summary",
		AttachmentID: attID,
		StreamStatus: "complete",
	}
	if err := a.db.CreateIngestSessionMessage(msg); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, map[string]interface{}{
		"attachment_id": attID,
		"path":          relPath,
		"message":       msg,
	})
}

func (a *API) summarizeAttachment(ctx context.Context, filename, relPath string, data []byte) string {
	extracted := extractAttachmentText(filename, data)
	// For attachment summarization, use global defaults
	lastProvider, _ := a.db.GetConfig("last_provider")
	lastModel, _ := a.db.GetConfig("last_model")
	client, _, _ := a.providerLLMClient(lastProvider, lastModel)
	if client == nil {
		if extracted != "" {
			return fmt.Sprintf("已上传附件 **%s**。\n\n提取内容摘要：\n%s", filename, truncateRunes(extracted, 500))
		}
		return fmt.Sprintf("已上传附件 **%s**（路径：`%s`）。请在对话中说明你想如何从该文件沉淀知识。", filename, relPath)
	}
	prompt := ingest.AttachmentSummaryPrompt(filename, extracted)
	ch, err := client.StreamChat(ctx, []llm.Message{
		{Role: "system", Content: "You help summarize uploaded files for a personal wiki ingest session. Reply in Chinese."},
		{Role: "user", Content: prompt},
	}, 0.3, 512)
	if err != nil {
		return fmt.Sprintf("已上传 **%s**，但理解失败：%v", filename, err)
	}
	var b strings.Builder
	for ev := range ch {
		if ev.Type == "token" {
			b.WriteString(ev.Content)
		}
	}
	if b.Len() == 0 {
		return fmt.Sprintf("已上传附件 **%s**（`%s`）。", filename, relPath)
	}
	return b.String()
}

func extractAttachmentText(filename string, data []byte) string {
	ext := strings.ToLower(filepath.Ext(filename))
	switch ext {
	case ".txt", ".md", ".markdown", ".json", ".csv", ".xml", ".html", ".htm":
		if len(data) > 12000 {
			data = data[:12000]
		}
		return string(data)
	default:
		return ""
	}
}

func truncateRunes(s string, max int) string {
	r := []rune(s)
	if len(r) <= max {
		return s
	}
	return string(r[:max]) + "…"
}

func (a *API) ArchiveIngestSession(w http.ResponseWriter, r *http.Request) {
	sessionID := getID(r)
	if !a.requireWorkspaceForIngest(w) {
		return
	}
	session, err := a.loadSession(sessionID, w)
	if err != nil || session == nil {
		return
	}
	count, err := a.db.CountUserSessionMessages(sessionID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if count == 0 {
		writeError(w, http.StatusBadRequest, "session has no user messages to archive")
		return
	}

	var req archiveSessionRequest
	if r.Body != nil {
		_ = json.NewDecoder(r.Body).Decode(&req)
	}
	title := strings.TrimSpace(req.Title)
	if title == "" {
		title = session.Title
	}
	if title == "" {
		title = "ingest-session"
	}

	msgs, err := a.db.ListIngestSessionMessages(sessionID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	archiveMsgs := make([]ingest.SessionArchiveMessage, 0, len(msgs))
	for _, m := range msgs {
		am := ingest.SessionArchiveMessage{
			Role:        m.Role,
			Content:     m.Content,
			MessageType: m.MessageType,
		}
		if m.AttachmentID != "" {
			am.AttachmentPath = filepath.ToSlash(filepath.Join(
				ingest.SessionAttachmentsDir(sessionID), m.AttachmentID))
		}
		archiveMsgs = append(archiveMsgs, am)
	}
	now := time.Now()
	md := ingest.BuildSessionArchiveMarkdown(sessionID, title, archiveMsgs, now)
	normalized, err := ingest.NormalizeSessionArchive(sessionID, title, md, "session:"+sessionID, now)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := a.writeFileBytesFirst(normalized.CanonicalPath, normalized.Content); err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("persist archive failed: %v", err))
		return
	}
	job, err := a.createQueuedIngestJob(string(normalized.Kind), normalized.CanonicalPath, normalized.SourceRef)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	_ = a.db.UpdateIngestSessionStatus(sessionID, "archived")
	if title != session.Title {
		_ = a.db.UpdateIngestSessionTitle(sessionID, title)
	}
	writeJSON(w, http.StatusCreated, archiveResponse{
		JobID:      job.ID,
		SourcePath: normalized.CanonicalPath,
		SessionID:  sessionID,
	})
}

func (a *API) loadSession(id string, w http.ResponseWriter) (*sqlite.IngestSession, error) {
	session, err := a.db.GetIngestSession(id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return nil, err
	}
	if session == nil {
		writeError(w, http.StatusNotFound, "session not found")
		return nil, fmt.Errorf("not found")
	}
	return session, nil
}

func (a *API) ListIngestSessionsHandler(w http.ResponseWriter, r *http.Request) {
	sessions, err := a.db.ListIngestSessions()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if sessions == nil {
		sessions = []sqlite.IngestSession{}
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"sessions": sessions,
	})
}

func (a *API) UpdateIngestSessionHandler(w http.ResponseWriter, r *http.Request) {
	sessionID := getID(r)
	session, err := a.loadSession(sessionID, w)
	if err != nil || session == nil {
		return
	}

	var req struct {
		Provider string `json:"provider"`
		Model    string `json:"model"`
		Title    string `json:"title"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	updated := false
	if req.Provider != "" || req.Model != "" {
		if err := a.db.UpdateIngestSessionLLM(sessionID, req.Provider, req.Model); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		// Also update last_used globally
		if req.Provider != "" {
			_ = a.db.SetConfig("last_provider", req.Provider)
		}
		if req.Model != "" {
			_ = a.db.SetConfig("last_model", req.Model)
		}
		updated = true
	}
	if req.Title != "" {
		_ = a.db.UpdateIngestSessionTitle(sessionID, req.Title)
		updated = true
	}

	if !updated {
		writeError(w, http.StatusBadRequest, "no fields to update")
		return
	}

	// Return updated session
	session, _ = a.db.GetIngestSession(sessionID)
	writeJSON(w, http.StatusOK, sessionResponse{Session: session})
}
