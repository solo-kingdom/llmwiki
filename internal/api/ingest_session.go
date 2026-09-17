package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/solo-kingdom/llmwiki/internal/acp"
	"github.com/solo-kingdom/llmwiki/internal/activity"
	"github.com/solo-kingdom/llmwiki/internal/agentruntime"
	"github.com/solo-kingdom/llmwiki/internal/ingest"
	"github.com/solo-kingdom/llmwiki/internal/llm"
	"github.com/solo-kingdom/llmwiki/internal/store/sqlite"
)

type appendMessageRequest struct {
	Content  string                  `json:"content"`
	WikiRefs []ingest.WikiRefRequest `json:"wiki_refs"`
}

type archiveSessionRequest struct {
	Title        string `json:"title"`
	DeepOrganize bool   `json:"deep_organize"`
}

type sessionResponse struct {
	Session      *sqlite.IngestSession       `json:"session"`
	ActiveReview *sqlite.ActiveReviewSummary `json:"active_review,omitempty"`
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
		AgentKind  string `json:"agent_kind"`
		ACPAgentID string `json:"acp_agent_id"`
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
	agentKind := req.AgentKind
	if agentKind == "" {
		agentKind, _ = a.db.GetConfig("default_agent_kind")
	}
	if agentKind == "" {
		agentKind = agentruntime.KindNative
	}
	acpAgentID := req.ACPAgentID
	if acpAgentID == "" && agentKind == agentruntime.KindACP {
		acpAgentID, _ = a.db.GetConfig("default_acp_agent_id")
	}
	if err := a.validateIngestSessionAgent(agentKind, acpAgentID); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	session := &sqlite.IngestSession{
		Title:         title,
		Status:        "active",
		LLMInstanceID: instanceID,
		LLMModel:      model,
		Mode:          mode,
		AgentKind:     agentKind,
		ACPAgentID:    acpAgentID,
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

func (a *API) validateIngestSessionAgent(kind, acpAgentID string) error {
	switch kind {
	case agentruntime.KindNative:
		return nil
	case agentruntime.KindACP:
		if strings.TrimSpace(acpAgentID) == "" {
			return fmt.Errorf("请先在 Settings 配置并选择 ACP Agent")
		}
		raw, err := a.db.GetConfig("acp_agents_json")
		if err != nil {
			return err
		}
		cfg, err := acp.ParseConfig(raw)
		if err != nil {
			return err
		}
		agent, ok := cfg.Agent(acpAgentID)
		if !ok {
			return fmt.Errorf("ACP Agent %q 不存在", acpAgentID)
		}
		if !agent.Enabled {
			return fmt.Errorf("该 ACP Agent 已禁用")
		}
		return nil
	default:
		return fmt.Errorf("agent_kind must be native or acp")
	}
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
	var activeReview *sqlite.ActiveReviewSummary
	if review, err := a.db.GetLatestIngestReviewBySessionID(id); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	} else {
		activeReview = sqlite.ActiveReviewSummaryFromReview(review)
	}
	writeJSON(w, http.StatusOK, sessionResponse{Session: session, ActiveReview: activeReview})
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
	a.streamAssistantReply(w, r, session, nil, filtered, llmUserContent, userMsg.Content, wikiRefs, assistantMsg, nil)
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
	runtime, err := a.sessionAgentRuntime(session)
	if err != nil {
		writeError(w, http.StatusBadRequest, runtimeErrorMessage(err))
		activity.LogSession(a.db, "stream_error", session.ID,
			"Agent runtime 初始化失败", "failure", "api",
			map[string]interface{}{"agent_kind": session.AgentKind, "acp_agent_id": session.ACPAgentID, "error": err.Error()})
		return
	}
	if session.AgentKind == agentruntime.KindACP && a.acpMgr != nil && !a.acpMgr.HasCapacity(session.ID) {
		w.Header().Set("Retry-After", "5")
		writeError(w, http.StatusServiceUnavailable, "ACP agent concurrency limit reached")
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

	a.streamAssistantReply(w, r, session, runtime, history, llmUserContent, userContent, wikiRefs, assistantMsg, userMsg)
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

func (a *API) streamAssistantReply(
	w http.ResponseWriter,
	r *http.Request,
	session *sqlite.IngestSession,
	runtime agentruntime.Runtime,
	history []sqlite.IngestSessionMessage,
	llmUserContent string,
	displayUserContent string,
	wikiRefs []ingest.WikiRefInput,
	assistantMsg *sqlite.IngestSessionMessage,
	userMsg *sqlite.IngestSessionMessage,
) {
	if runtime == nil {
		var err error
		runtime, err = a.sessionAgentRuntime(session)
		if err != nil {
			writeError(w, http.StatusBadRequest, runtimeErrorMessage(err))
			activity.LogSession(a.db, "stream_error", session.ID,
				"Agent runtime 初始化失败", "failure", "api",
				map[string]interface{}{"agent_kind": session.AgentKind, "acp_agent_id": session.ACPAgentID, "error": err.Error()})
			return
		}
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

	recorder := ingest.NewSessionMessageRecorder(a.db, assistantMsg.ID)
	sink := newSSEEventSink(sendEvent, a.db, assistantMsg.ID, recorder)
	req := agentruntime.PromptRequest{
		SessionID:          session.ID,
		Mode:               session.Mode,
		DocLang:            ResolveDocLanguage(a.db),
		UserContent:        llmUserContent,
		DisplayUserContent: displayUserContent,
		History:            history,
		WikiRefs:           wikiRefs,
		Recorder:           recorder,
	}
	result, promptErr := runtime.Prompt(r.Context(), req, sink)
	content := sink.Flush()

	streamStatus := streamStatusForStopReason(result.StopReason)
	if promptErr != nil {
		if r.Context().Err() != nil || errors.Is(promptErr, context.Canceled) {
			streamStatus = "incomplete"
		} else {
			streamStatus = "failed"
		}
	}
	if strings.TrimSpace(content) == "" && streamStatus != "incomplete" {
		streamStatus = "failed"
		content = "LLM returned an empty response"
	}
	if streamStatus == "failed" && promptErr != nil && strings.TrimSpace(result.Text) == "" {
		content = promptErr.Error()
	}

	_ = a.db.UpdateIngestSessionMessageContent(assistantMsg.ID, content, streamStatus)
	assistantMsg.Content = content
	assistantMsg.StreamStatus = streamStatus
	if promptErr != nil {
		activity.LogSession(a.db, "stream_error", session.ID,
			promptErr.Error(), "failure", "api", map[string]interface{}{
				"agent_kind": session.AgentKind, "stop_reason": result.StopReason, "stream_status": streamStatus,
			})
	}
	if promptErr != nil && r.Context().Err() == nil {
		sendEvent("error", map[string]string{"message": promptErr.Error()})
	}
	sendEvent("done", assistantMsg)
}

func streamStatusForStopReason(stopReason string) string {
	switch stopReason {
	case "end_turn", "max_tokens", "max_turn_requests":
		return "complete"
	case "cancelled":
		return "incomplete"
	case "refusal":
		return "failed"
	default:
		return "failed"
	}
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
		DeepOrganize:      req.DeepOrganize,
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
	if a.acpMgr != nil {
		a.acpMgr.CloseSession(sessionID)
	}
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
		InstanceID string  `json:"instance_id"`
		Model      string  `json:"model"`
		Title      string  `json:"title"`
		Mode       string  `json:"mode"`
		AgentKind  *string `json:"agent_kind"`
		ACPAgentID *string `json:"acp_agent_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.AgentKind != nil {
		if session.Status == "archived" {
			writeError(w, http.StatusConflict, "archived session cannot switch agent runtime")
			return
		}
		history, err := a.db.ListIngestSessionMessages(sessionID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		if sessionHasStreamingAssistant(history) {
			writeError(w, http.StatusConflict, "another message is still streaming")
			return
		}
		kind := strings.TrimSpace(*req.AgentKind)
		acpAgentID := session.ACPAgentID
		if req.ACPAgentID != nil {
			acpAgentID = strings.TrimSpace(*req.ACPAgentID)
		}
		if err := a.validateIngestSessionAgent(kind, acpAgentID); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
	}

	updated := false
	if req.InstanceID != "" || req.Model != "" {
		if err := a.db.UpdateIngestSessionLLM(sessionID, req.InstanceID, req.Model); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
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
	if req.AgentKind != nil {
		kind := strings.TrimSpace(*req.AgentKind)
		acpAgentID := session.ACPAgentID
		if req.ACPAgentID != nil {
			acpAgentID = strings.TrimSpace(*req.ACPAgentID)
		}
		if kind == agentruntime.KindNative {
			acpAgentID = ""
		}
		if err := a.db.UpdateIngestSessionAgent(sessionID, kind, acpAgentID); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		_ = a.db.SetConfig("default_agent_kind", kind)
		_ = a.db.SetConfig("default_acp_agent_id", acpAgentID)
		updated = true
	}

	if !updated {
		writeError(w, http.StatusBadRequest, "no fields to update")
		return
	}

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
	if a.acpMgr != nil {
		a.acpMgr.CloseSession(sessionID)
	}
	if a.workspace != "" {
		if err := ingest.RemoveSessionDir(a.workspace, sessionID); err != nil {
			writeError(w, http.StatusInternalServerError, fmt.Sprintf("remove session files: %v", err))
			return
		}
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

type sessionMessageEventsResponse struct {
	Events []sqlite.SessionMessageEvent `json:"events"`
}

func (a *API) GetSessionMessageEvents(w http.ResponseWriter, r *http.Request) {
	sessionID := chi.URLParam(r, "id")
	messageID := chi.URLParam(r, "messageId")
	if sessionID == "" || messageID == "" {
		writeError(w, http.StatusBadRequest, "missing session or message id")
		return
	}

	// Verify message belongs to session
	msg, err := a.db.GetIngestSessionMessage(messageID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if msg == nil {
		writeError(w, http.StatusNotFound, "message not found")
		return
	}
	if msg.SessionID != sessionID {
		writeError(w, http.StatusNotFound, "message not found")
		return
	}

	limit := getIntQuery(r, "limit", 200)
	events, err := a.db.ListSessionMessageEvents(messageID, limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if events == nil {
		events = []sqlite.SessionMessageEvent{}
	}
	writeJSON(w, http.StatusOK, sessionMessageEventsResponse{Events: events})
}
