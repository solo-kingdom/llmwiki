package api

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"path/filepath"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/solo-kingdom/llmwiki/internal/activity"
	"github.com/solo-kingdom/llmwiki/internal/ingest"
	"github.com/solo-kingdom/llmwiki/internal/llm"
	"github.com/solo-kingdom/llmwiki/internal/mcp"
	"github.com/solo-kingdom/llmwiki/internal/store/sqlite"
)

type createSessionRequest struct {
	Title string `json:"title"`
}

type appendMessageRequest struct {
	Content  string                `json:"content"`
	WikiRefs []ingest.WikiRefRequest `json:"wiki_refs"`
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
	ReviewID   string `json:"review_id"`
	Status     string `json:"status"`
	SourcePath string `json:"source_path"`
	SessionID  string `json:"session_id"`
	PlanJobID  string `json:"plan_job_id,omitempty"`
}

func (a *API) CreateIngestSession(w http.ResponseWriter, r *http.Request) {
	if !a.requireWorkspaceForIngest(w) {
		return
	}
	var req struct {
		Title      string `json:"title"`
		InstanceID string `json:"instance_id"`
		Model      string `json:"model"`
		Mode       string `json:"mode"`
	}
	if r.Body != nil {
		_ = json.NewDecoder(r.Body).Decode(&req)
	}

	// Read instance/model: request overrides, fallback to global defaults
	instanceID := req.InstanceID
	model := req.Model
	if instanceID == "" {
		instanceID, _ = a.db.GetConfig("last_instance_id")
	}
	if model == "" {
		model, _ = a.db.GetConfig("last_model")
	}

	title := strings.TrimSpace(req.Title)
	if title == "" {
		count, err := a.db.CountIngestSessions()
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		title = ingest.DefaultIngestSessionTitle(count+1, time.Now())
	}

	mode := req.Mode
	if mode == "" {
		mode = "ingest"
	}
	session := &sqlite.IngestSession{
		Title:         title,
		Status:        "active",
		LLMInstanceID: instanceID,
		LLMModel:      model,
		Mode:          mode,
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

	wikiRefs, err := ingest.ParseWikiRefRequests(a.db, req.WikiRefs)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	stream := r.URL.Query().Get("stream") == "1" || strings.Contains(r.Header.Get("Accept"), "text/event-stream")
	if stream {
		a.streamSessionReply(w, r, session, req.Content, wikiRefs)
		return
	}

	userMsg := &sqlite.IngestSessionMessage{
		SessionID:    sessionID,
		Role:         "user",
		Content:      req.Content,
		MessageType:  "text",
		StreamStatus: "complete",
		WikiRefsJSON: ingest.WikiRefsJSONFromInputs(wikiRefs),
	}
	if err := a.db.CreateIngestSessionMessage(userMsg); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	ingest.RecordSessionReferences(a.db, sessionID, wikiRefs, sqlite.SessionRefSourceUserMention)
	writeJSON(w, http.StatusCreated, messageResponse{Message: userMsg})
}

func (a *API) RetryIngestSessionMessage(w http.ResponseWriter, r *http.Request) {
	sessionID := getID(r)
	messageID := chi.URLParam(r, "messageId")
	if !a.requireWorkspaceForIngest(w) {
		return
	}
	session, err := a.loadSession(sessionID, w)
	if err != nil || session == nil {
		return
	}

	stream := r.URL.Query().Get("stream") == "1" || strings.Contains(r.Header.Get("Accept"), "text/event-stream")
	if !stream {
		writeError(w, http.StatusBadRequest, "streaming is required for retry")
		return
	}

	assistantMsg, err := a.db.GetIngestSessionMessage(messageID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if assistantMsg == nil || assistantMsg.SessionID != session.ID {
		writeError(w, http.StatusNotFound, "message not found")
		return
	}
	if assistantMsg.Role != "assistant" {
		writeError(w, http.StatusBadRequest, "only assistant messages can be retried")
		return
	}
	if assistantMsg.StreamStatus != "failed" && assistantMsg.StreamStatus != "incomplete" {
		writeError(w, http.StatusBadRequest, "message is not in a retriable state")
		return
	}

	history, err := a.db.ListIngestSessionMessages(session.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if sessionHasStreamingAssistant(history) {
		writeError(w, http.StatusConflict, "another message is still streaming")
		return
	}

	userMsg := findPairedUserMessage(history, assistantMsg.ID)
	if userMsg == nil || strings.TrimSpace(userMsg.Content) == "" {
		writeError(w, http.StatusBadRequest, "no user message found for retry")
		return
	}

	if err := a.db.UpdateIngestSessionMessageContent(assistantMsg.ID, "", "streaming"); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	assistantMsg.Content = ""
	assistantMsg.StreamStatus = "streaming"

	filtered := filterHistoryForRetry(history, assistantMsg.ID, userMsg.ID)
	wikiRefs, _ := ingest.WikiRefsFromStoredJSON(userMsg.WikiRefsJSON)
	llmUserContent, err := a.buildLLMUserContent(r.Context(), userMsg.Content, wikiRefs)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	a.streamAssistantReply(w, r, session, filtered, llmUserContent, userMsg.Content, wikiRefs, assistantMsg, nil)
}

func (a *API) PatchIngestSessionMessage(w http.ResponseWriter, r *http.Request) {
	sessionID := getID(r)
	messageID := chi.URLParam(r, "messageId")
	if !a.requireWorkspaceForIngest(w) {
		return
	}
	session, err := a.loadSession(sessionID, w)
	if err != nil || session == nil {
		return
	}
	msg, err := a.db.GetIngestSessionMessage(messageID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if msg == nil || msg.SessionID != session.ID {
		writeError(w, http.StatusNotFound, "message not found")
		return
	}
	var req struct {
		ExcludeFromArchive *bool `json:"exclude_from_archive"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.ExcludeFromArchive == nil {
		writeError(w, http.StatusBadRequest, "exclude_from_archive is required")
		return
	}
	if err := a.db.UpdateIngestSessionMessageExclude(messageID, *req.ExcludeFromArchive); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	msg.ExcludeFromArchive = *req.ExcludeFromArchive
	writeJSON(w, http.StatusOK, messageResponse{Message: msg})
}

func (a *API) ListIngestSessionReferences(w http.ResponseWriter, r *http.Request) {
	sessionID := getID(r)
	session, err := a.loadSession(sessionID, w)
	if err != nil || session == nil {
		return
	}
	refs, err := a.db.ListSessionReferences(sessionID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if refs == nil {
		refs = []sqlite.IngestSessionReference{}
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"references": refs})
}

func (a *API) streamSessionReply(w http.ResponseWriter, r *http.Request, session *sqlite.IngestSession, userContent string, wikiRefs []ingest.WikiRefInput) {
	llmClient, instanceID, model := a.sessionLLMClient(session)
	if llmClient == nil {
		if instanceID == "" || model == "" {
			writeError(w, http.StatusBadRequest, "请先选择 Provider 实例和 Model")
		} else {
			writeError(w, http.StatusBadRequest, "Provider 实例不存在或未配置 API Key")
		}
		activity.LogSession(a.db, "stream_error", session.ID,
			"LLM 客户端初始化失败", "failure", "api",
			map[string]interface{}{"instance_id": instanceID, "model": model})
		return
	}

	history, err := a.db.ListIngestSessionMessages(session.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if sessionHasStreamingAssistant(history) {
		writeError(w, http.StatusConflict, "another message is still streaming")
		return
	}

	userMsg := &sqlite.IngestSessionMessage{
		SessionID:    session.ID,
		Role:         "user",
		Content:      userContent,
		MessageType:  "text",
		StreamStatus: "complete",
		WikiRefsJSON: ingest.WikiRefsJSONFromInputs(wikiRefs),
	}
	if err := a.db.CreateIngestSessionMessage(userMsg); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	ingest.RecordSessionReferences(a.db, session.ID, wikiRefs, sqlite.SessionRefSourceUserMention)

	llmUserContent, err := a.buildLLMUserContent(r.Context(), userContent, wikiRefs)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
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

	a.streamAssistantReply(w, r, session, history, llmUserContent, userContent, wikiRefs, assistantMsg, userMsg)
}

func (a *API) buildLLMUserContent(_ context.Context, userText string, wikiRefs []ingest.WikiRefInput) (string, error) {
	if len(wikiRefs) == 0 {
		return userText, nil
	}
	bodies, err := ingest.LoadWikiPageBodies(a.db, wikiRefs)
	if err != nil {
		return "", err
	}
	docLang := ResolveDocLanguage(a.db)
	return ingest.InjectWikiRefsIntoUserContent(docLang, wikiRefs, bodies, userText), nil
}

func (a *API) sessionChatRouter() *mcp.Router {
	raw, _ := a.db.GetConfig("mcp_servers_json")
	reg, err := mcp.NewRegistry(raw)
	if err != nil {
		return nil
	}
	return mcp.NewRouter(reg, nil)
}

func (a *API) streamAssistantReply(
	w http.ResponseWriter,
	r *http.Request,
	session *sqlite.IngestSession,
	history []sqlite.IngestSessionMessage,
	llmUserContent string,
	displayUserContent string,
	wikiRefs []ingest.WikiRefInput,
	assistantMsg *sqlite.IngestSessionMessage,
	userMsg *sqlite.IngestSessionMessage,
) {
	client, instanceID, model := a.sessionLLMClient(session)
	if client == nil {
		if instanceID == "" || model == "" {
			writeError(w, http.StatusBadRequest, "请先选择 Provider 实例和 Model")
		} else {
			writeError(w, http.StatusBadRequest, "Provider 实例不存在或未配置 API Key")
		}
		activity.LogSession(a.db, "stream_error", session.ID,
			"LLM 客户端初始化失败", "failure", "api",
			map[string]interface{}{"instance_id": instanceID, "model": model})
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

	if userMsg != nil {
		sendEvent("user_message", userMsg)
	}
	sendEvent("assistant_start", map[string]string{"id": assistantMsg.ID})

	docLang := ResolveDocLanguage(a.db)
	resolver := &ingest.ContextResolver{DB: a.db, Workspace: a.workspace}
	subset, err := resolver.ResolveRelatedSubset(displayUserContent, wikiRefs)
	if err != nil {
		log.Printf("[ingest-session] subset resolve failed session=%s: %v", session.ID, err)
	}
	subsetSection := ingest.FormatRelatedSubsetSection(docLang, subset)

	step := ingest.PromptStepForMode(session.Mode)
	msgs := ingest.AssembleIngestChatMessages(
		history, llmUserContent, docLang, a.workspace, ingest.ResolveRulesSupplement(a.db), subsetSection, step,
	)
	ctx := r.Context()

	router := a.sessionChatRouter()
	onToolRead := func(documentID, relativePath, title string) {
		ingest.RecordToolReadReference(a.db, session.ID, documentID, relativePath, title)
	}
	executor := ingest.NewChatWikiExecutor(a.workspace, a.db, session.ID, router, session.Mode, onToolRead)
	tools, _ := executor.ListTools(ctx)

	toolHandler := func(phase, toolName, detail string) {
		eventType := "tool_done"
		if phase == "start" {
			eventType = "tool_start"
		}
		sendEvent(eventType, map[string]string{
			"tool":   toolName,
			"detail": detail,
		})
	}

	cfg := mcp.ToolLoopConfigForMode(session.Mode)
	temp := mcp.ToolTemperatureForMode(session.Mode)
	tokens := mcp.ToolMaxTokensForMode(session.Mode)
	finalText, err := ingest.RunSessionChatToolLoop(ctx, client, executor, msgs, tools, temp, tokens, cfg, toolHandler)
	if err != nil {
		log.Printf(
			"[ingest-session] tool loop failed session=%s instance=%s model=%s: %v; falling back to stream",
			session.ID, instanceID, model, err,
		)
		a.streamSessionChatDirect(ctx, w, sendEvent, client, session, instanceID, model, msgs, assistantMsg)
		return
	}

	streamStatus := "complete"
	if strings.TrimSpace(finalText) == "" {
		streamStatus = "failed"
		lastErr := "LLM returned an empty response"
		_ = a.db.UpdateIngestSessionMessageContent(assistantMsg.ID, lastErr, streamStatus)
		sendEvent("error", map[string]string{"message": lastErr})
		return
	}

	// Emit final text in chunks for progressive UI rendering.
	chunkSize := 48
	runes := []rune(finalText)
	for i := 0; i < len(runes); i += chunkSize {
		end := i + chunkSize
		if end > len(runes) {
			end = len(runes)
		}
		part := string(runes[i:end])
		sendEvent("token", map[string]string{"content": part})
		if i == 0 {
			_ = a.db.UpdateIngestSessionMessageContent(assistantMsg.ID, part, "streaming")
		} else {
			cur, _ := a.db.GetIngestSessionMessage(assistantMsg.ID)
			if cur != nil {
				_ = a.db.UpdateIngestSessionMessageContent(assistantMsg.ID, cur.Content+part, "streaming")
			}
		}
	}
	_ = a.db.UpdateIngestSessionMessageContent(assistantMsg.ID, finalText, streamStatus)
	assistantMsg.Content = finalText
	assistantMsg.StreamStatus = streamStatus
	sendEvent("done", assistantMsg)
}

func (a *API) streamSessionChatDirect(
	ctx context.Context,
	w http.ResponseWriter,
	sendEvent func(string, interface{}),
	client *llm.Client,
	session *sqlite.IngestSession,
	instanceID, model string,
	msgs []llm.Message,
	assistantMsg *sqlite.IngestSessionMessage,
) {
	ch, err := client.StreamChat(ctx, msgs, 0.7, 2048)
	if err != nil {
		log.Printf(
			"[ingest-session] stream start failed session=%s instance=%s model=%s: %v",
			session.ID, instanceID, model, err,
		)
		_ = a.db.UpdateIngestSessionMessageContent(assistantMsg.ID, err.Error(), "failed")
		sendEvent("error", map[string]string{"message": err.Error()})
		activity.LogSession(a.db, "stream_error", session.ID,
			err.Error(), "failure", "api",
			map[string]interface{}{"instance_id": instanceID, "model": model})
		return
	}

	var builder strings.Builder
	streamStatus := "complete"
	var lastErr string
	lastFlush := time.Now()
	lastFlushLen := 0
	flushStreaming := func(force bool) {
		curLen := builder.Len()
		if !force && curLen == lastFlushLen {
			return
		}
		if !force && curLen-lastFlushLen < 32 && time.Since(lastFlush) < 300*time.Millisecond {
			return
		}
		_ = a.db.UpdateIngestSessionMessageContent(assistantMsg.ID, builder.String(), "streaming")
		lastFlush = time.Now()
		lastFlushLen = curLen
	}
	for ev := range ch {
		if ctx.Err() != nil {
			streamStatus = "incomplete"
			break
		}
		switch ev.Type {
		case "token":
			builder.WriteString(ev.Content)
			sendEvent("token", map[string]string{"content": ev.Content})
			flushStreaming(false)
		case "error":
			streamStatus = "failed"
			if ev.Error != nil {
				lastErr = ev.Error.Error()
				sendEvent("error", map[string]string{"message": lastErr})
			} else {
				lastErr = "LLM stream failed"
				sendEvent("error", map[string]string{"message": lastErr})
			}
		}
	}
	if ctx.Err() != nil && streamStatus == "complete" {
		streamStatus = "incomplete"
	}
	if streamStatus == "complete" && builder.Len() == 0 {
		streamStatus = "failed"
		lastErr = "LLM returned an empty response"
		sendEvent("error", map[string]string{"message": lastErr})
	}
	content := builder.String()
	if content == "" && lastErr != "" &&
		(streamStatus == "failed" || streamStatus == "incomplete") {
		content = lastErr
	}
	_ = a.db.UpdateIngestSessionMessageContent(assistantMsg.ID, content, streamStatus)
	assistantMsg.Content = content
	assistantMsg.StreamStatus = streamStatus
	if streamStatus == "failed" || streamStatus == "incomplete" {
		activity.LogSession(a.db, "stream_error", session.ID,
			lastErr, "failure", "api",
			map[string]interface{}{
				"stream_status": streamStatus,
				"instance_id":   instanceID,
				"model":         model,
			})
		return
	}
	sendEvent("done", assistantMsg)
	_ = w
}

func sessionHasStreamingAssistant(msgs []sqlite.IngestSessionMessage) bool {
	for _, m := range msgs {
		if m.Role == "assistant" && m.StreamStatus == "streaming" {
			return true
		}
	}
	return false
}

func findPairedUserMessage(msgs []sqlite.IngestSessionMessage, assistantID string) *sqlite.IngestSessionMessage {
	idx := -1
	for i, m := range msgs {
		if m.ID == assistantID {
			idx = i
			break
		}
	}
	if idx <= 0 {
		return nil
	}
	for i := idx - 1; i >= 0; i-- {
		if msgs[i].Role == "user" && strings.TrimSpace(msgs[i].Content) != "" {
			return &msgs[i]
		}
	}
	return nil
}

func filterHistoryForRetry(history []sqlite.IngestSessionMessage, assistantID, userID string) []sqlite.IngestSessionMessage {
	out := make([]sqlite.IngestSessionMessage, 0, len(history))
	for _, m := range history {
		if m.ID == assistantID || m.ID == userID {
			continue
		}
		out = append(out, m)
	}
	return out
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
	lastInstanceID, _ := a.db.GetConfig("last_instance_id")
	lastModel, _ := a.db.GetConfig("last_model")
	client, _, _ := a.instanceLLMClient(lastInstanceID, lastModel)
	if client == nil {
		if extracted != "" {
			return fmt.Sprintf("已上传附件 **%s**。\n\n提取内容摘要：\n%s", filename, truncateRunes(extracted, 500))
		}
		return fmt.Sprintf("已上传附件 **%s**（路径：`%s`）。请在对话中说明你想如何从该文件沉淀知识。", filename, relPath)
	}
	docLang := ResolveDocLanguage(a.db)
	prompt := ingest.AttachmentSummaryPrompt(filename, extracted, docLang)
	langName := "Chinese"
	if docLang == "en" {
		langName = "English"
	}
	ch, err := client.StreamChat(ctx, []llm.Message{
		{Role: "system", Content: fmt.Sprintf("You help summarize uploaded files for a personal wiki ingest session. Reply in %s.", langName)},
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

func (a *API) archiveResponseForReview(review *sqlite.IngestReview) archiveResponse {
	resp := archiveResponse{
		ReviewID:   review.ID,
		Status:     review.Status,
		SourcePath: review.ArchiveSourcePath,
		SessionID:  review.SessionID,
	}
	job, err := a.db.GetIngestJobBySourceRef(
		ingest.ReviewSourceRef(review.ID),
		string(ingest.InputKindReviewPlan),
	)
	if err == nil && job != nil {
		resp.PlanJobID = job.ID
	}
	return resp
}

func (a *API) tryReturnExistingArchive(w http.ResponseWriter, session *sqlite.IngestSession) bool {
	existing, err := a.db.GetLatestIngestReviewBySessionID(session.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return true
	}

	if session.Status == "archived" {
		if existing == nil {
			writeError(w, http.StatusConflict, "session already archived")
			return true
		}
		writeJSON(w, http.StatusOK, a.archiveResponseForReview(existing))
		return true
	}

	if existing != nil && sqlite.IsActiveIngestReviewStatus(existing.Status) {
		job, err := a.db.GetIngestJobBySourceRef(
			ingest.ReviewSourceRef(existing.ID),
			string(ingest.InputKindReviewPlan),
		)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return true
		}
		if job == nil {
			if _, err := ingest.EnqueueReviewPlanJob(a.db, a.workspace, existing); err != nil {
				writeError(w, http.StatusInternalServerError, err.Error())
				return true
			}
		}
		writeJSON(w, http.StatusOK, a.archiveResponseForReview(existing))
		return true
	}

	return false
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

	if a.tryReturnExistingArchive(w, session) {
		return
	}

	activity.LogSession(a.db, "archive_started", sessionID,
		fmt.Sprintf("会话 %s 开始归档", sessionID), "pending", "api", nil)

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
		a.logArchiveFailed(sessionID, err.Error())
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	archiveMsgs := make([]ingest.SessionArchiveMessage, 0, len(msgs))
	for _, m := range msgs {
		if m.ExcludeFromArchive {
			continue
		}
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
	sessionRefs, err := a.db.ListSessionReferences(sessionID)
	if err != nil {
		a.logArchiveFailed(sessionID, err.Error())
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	archiveRefs := make([]ingest.SessionArchiveReference, 0, len(sessionRefs))
	for _, ref := range sessionRefs {
		archiveRefs = append(archiveRefs, ingest.SessionArchiveReference{
			Path:   ref.RelativePath,
			Title:  ref.Title,
			Source: ref.Source,
		})
	}
	md := ingest.BuildSessionArchiveMarkdown(sessionID, title, session.Mode, archiveMsgs, archiveRefs, now)
	normalized, err := ingest.NormalizeSessionArchive(sessionID, title, md, "session:"+sessionID, now)
	if err != nil {
		a.logArchiveFailed(sessionID, err.Error())
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := a.writeFileBytesFirst(normalized.CanonicalPath, normalized.Content); err != nil {
		msg := fmt.Sprintf("persist archive failed: %v", err)
		a.logArchiveFailed(sessionID, msg)
		writeError(w, http.StatusInternalServerError, msg)
		return
	}

	review := &sqlite.IngestReview{
		SessionID:         sessionID,
		ArchiveSourcePath: normalized.CanonicalPath,
		Status:            "planning",
	}
	if err := a.db.CreateIngestReview(review); err != nil {
		a.rollbackArchiveAttempt("", normalized.CanonicalPath, "")
		a.logArchiveFailed(sessionID, err.Error())
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	planJob, err := ingest.EnqueueReviewPlanJob(a.db, a.workspace, review)
	if err != nil {
		a.rollbackArchiveAttempt(review.ID, normalized.CanonicalPath, "")
		a.logArchiveFailed(sessionID, err.Error())
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	tx, err := a.db.DB().Begin()
	if err != nil {
		a.rollbackArchiveAttempt(review.ID, normalized.CanonicalPath, planJob.ID)
		a.logArchiveFailed(sessionID, err.Error())
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if _, err := tx.Exec(
		`UPDATE ingest_sessions SET status = ?, updated_at = datetime('now') WHERE id = ?`,
		"archived", sessionID,
	); err != nil {
		_ = tx.Rollback()
		a.rollbackArchiveAttempt(review.ID, normalized.CanonicalPath, planJob.ID)
		a.logArchiveFailed(sessionID, err.Error())
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if title != session.Title {
		if _, err := tx.Exec(
			`UPDATE ingest_sessions SET title = ?, updated_at = datetime('now') WHERE id = ?`,
			title, sessionID,
		); err != nil {
			_ = tx.Rollback()
			a.rollbackArchiveAttempt(review.ID, normalized.CanonicalPath, planJob.ID)
			a.logArchiveFailed(sessionID, err.Error())
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
	}
	if err := tx.Commit(); err != nil {
		a.rollbackArchiveAttempt(review.ID, normalized.CanonicalPath, planJob.ID)
		a.logArchiveFailed(sessionID, err.Error())
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	activity.Record(a.db, activity.Entry{
		Level:        "info",
		Category:     "ingest",
		Action:       "review_created",
		Message:      fmt.Sprintf("归档审阅已创建，等待计划生成"),
		ResourceType: "review",
		ResourceID:   review.ID,
		Status:       "pending",
		Source:       "api",
		Details: map[string]interface{}{
			"session_id":  sessionID,
			"plan_job_id": planJob.ID,
		},
	})
	writeJSON(w, http.StatusCreated, archiveResponse{
		ReviewID:   review.ID,
		Status:     review.Status,
		SourcePath: normalized.CanonicalPath,
		SessionID:  sessionID,
		PlanJobID:  planJob.ID,
	})
}

func (a *API) logArchiveFailed(sessionID, message string) {
	activity.LogSession(a.db, "archive_failed", sessionID, message, "failure", "api", nil)
}

func (a *API) rollbackArchiveAttempt(reviewID, archivePath, planJobID string) {
	if planJobID != "" {
		_, _ = a.db.DB().Exec(`DELETE FROM ingest_jobs WHERE id = ?`, planJobID)
	}
	if reviewID != "" {
		_ = a.db.DeleteIngestReview(reviewID)
	}
	_ = a.removeWorkspaceFile(archivePath)
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
		InstanceID string `json:"instance_id"`
		Model      string `json:"model"`
		Title      string `json:"title"`
		Mode       string `json:"mode"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	updated := false
	if req.InstanceID != "" || req.Model != "" {
		if err := a.db.UpdateIngestSessionLLM(sessionID, req.InstanceID, req.Model); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		// Also update last_used globally
		if req.InstanceID != "" {
			_ = a.db.SetConfig("last_instance_id", req.InstanceID)
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
	if req.Mode != "" {
		validModes := map[string]bool{"ingest": true, "qa": true, "organize": true}
		if !validModes[req.Mode] {
			writeError(w, http.StatusBadRequest, "invalid mode, must be one of: ingest, qa, organize")
			return
		}
		if err := a.db.UpdateIngestSessionMode(sessionID, req.Mode); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
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

func (a *API) DeleteIngestSessionHandler(w http.ResponseWriter, r *http.Request) {
	sessionID := getID(r)
	session, err := a.loadSession(sessionID, w)
	if err != nil || session == nil {
		return
	}
	if err := a.db.DeleteIngestSession(sessionID); err != nil {
		if strings.Contains(err.Error(), "not found") {
			writeError(w, http.StatusNotFound, "session not found")
			return
		}
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if a.workspace != "" {
		if err := ingest.RemoveSessionDir(a.workspace, sessionID); err != nil {
			writeError(w, http.StatusInternalServerError, fmt.Sprintf("remove session files: %v", err))
			return
		}
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}
