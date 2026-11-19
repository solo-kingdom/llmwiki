import path from "node:path";
import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import { logSession, record } from "../activity/index.js";
import { parseConfig as parseAcpConfig, getAgent } from "../acp/config.js";
import { availability } from "../acp/check.js";
import {
  KIND_ACP,
  KIND_NATIVE,
  type WikiRefInput,
} from "../agentruntime/runtime.js";
import {
  injectWikiRefsIntoUserContent,
  loadWikiPageBodies,
} from "../ingest/context.js";
import { attachmentSummaryPrompt } from "../ingest/session_chat.js";
import {
  buildSessionArchiveMarkdown,
  defaultIngestSessionTitle,
  ensureSessionDirs,
  normalizeSessionArchive,
  removeSessionDir,
  sessionAttachmentsDir,
  writeSessionAttachment,
} from "../ingest/session_store.js";
import {
  createSessionMessageRecorder,
  recordSessionReferences,
  wikiRefsFromStoredJson,
  wikiRefsJsonFromInputs,
} from "../ingest/tools.js";
import { enqueueReviewPlanJob } from "../ingest/processor.js";
import { reviewSourceRef } from "../ingest/review.js";
import { INPUT_KIND_REVIEW_PLAN } from "../ingest/types.js";
import { clientFromInstance } from "../llm/instance_client.js";
import type { IngestReview, IngestSession, IngestSessionMessage } from "../store/types.js";
import {
  getID,
  getIntQuery,
  isStreamRequest,
  readJsonBody,
  removeWorkspaceFile,
  runtimeErrorMessage,
  sessionAgentRuntime,
  writeError,
  writeFileBytesFirst,
  writeJson,
  type ApiContext,
} from "./context.js";
import { SseEventSink } from "./session_event_sink.js";

const MAX_SESSION_WIKI_REFS = 5;

interface WikiRefRequest {
  document_id?: string;
  relative_path?: string;
}

async function parseWikiRefRequests(
  ctx: ApiContext,
  refs: WikiRefRequest[],
): Promise<WikiRefInput[]> {
  if (refs.length > MAX_SESSION_WIKI_REFS) {
    throw new Error(`at most ${MAX_SESSION_WIKI_REFS} wiki_refs allowed`);
  }
  const out: WikiRefInput[] = [];
  for (const ref of refs) {
    const documentId = (ref.document_id ?? "").trim();
    const doc = await ctx.db.getWikiDocumentByID(documentId);
    if (!doc) throw new Error(`wiki document not found: ${ref.document_id}`);
    const requested = (ref.relative_path ?? "").trim();
    if (requested && requested !== doc.relative_path) {
      throw new Error(`relative_path mismatch for document ${ref.document_id}`);
    }
    out.push({
      documentId: doc.id,
      relativePath: doc.relative_path,
      title: doc.title,
    });
  }
  return out;
}

async function resolveDocLanguage(ctx: ApiContext): Promise<string> {
  try {
    const value = await ctx.db.getConfig("doc_language");
    return value === "en" || value === "zh" ? value : "zh";
  } catch {
    return "zh";
  }
}

function sessionHasStreamingAssistant(messages: IngestSessionMessage[]): boolean {
  return messages.some((message) => message.role === "assistant" && message.stream_status === "streaming");
}

function findPairedUserMessage(
  messages: IngestSessionMessage[],
  assistantId: string,
): IngestSessionMessage | null {
  const index = messages.findIndex((message) => message.id === assistantId);
  if (index <= 0) return null;
  for (let i = index - 1; i >= 0; i -= 1) {
    const message = messages[i]!;
    if (message.role === "user" && message.content.trim()) return message;
  }
  return null;
}

function filterHistoryForRetry(
  history: IngestSessionMessage[],
  assistantId: string,
  userId: string,
): IngestSessionMessage[] {
  return history.filter((message) => message.id !== assistantId && message.id !== userId);
}

function streamStatusForStopReason(stopReason: string): string {
  switch (stopReason) {
    case "end_turn":
    case "max_tokens":
    case "max_turn_requests":
      return "complete";
    case "cancelled":
      return "incomplete";
    default:
      return "failed";
  }
}

function truncateRunes(value: string, max: number): string {
  const runes = [...value];
  return runes.length <= max ? value : `${runes.slice(0, max).join("")}…`;
}

function extractAttachmentText(filename: string, data: Uint8Array): string {
  const ext = path.extname(filename).toLowerCase();
  switch (ext) {
    case ".txt":
    case ".md":
    case ".markdown":
    case ".json":
    case ".csv":
    case ".xml":
    case ".html":
    case ".htm": {
      const text = new TextDecoder().decode(data.slice(0, 12000));
      return text;
    }
    default:
      return "";
  }
}

export function ingestSessionsApi(ctx: ApiContext) {
  async function loadSession(c: Context): Promise<IngestSession | Response> {
    try {
      const session = await ctx.db.getIngestSession(getID(c));
      if (!session) return writeError(c, 404, "session not found");
      return session;
    } catch (error) {
      return writeError(c, 500, errorMessage(error));
    }
  }

  async function validateSessionAgent(kind: string, acpAgentId: string): Promise<void> {
    if (kind === KIND_NATIVE) return;
    if (kind !== KIND_ACP) throw new Error("agent_kind must be native or acp");
    if (!acpAgentId.trim()) throw new Error("请先在 Settings 配置并选择 ACP Agent");
    const raw = await ctx.db.getConfig("acp_agents_json");
    const cfg = parseAcpConfig(raw);
    const agent = getAgent(cfg, acpAgentId);
    if (!agent) throw new Error(`ACP Agent "${acpAgentId}" 不存在`);
    if (!agent.enabled) throw new Error("该 ACP Agent 已禁用");
  }

  async function buildLlmUserContent(userText: string, wikiRefs: WikiRefInput[]): Promise<string> {
    if (wikiRefs.length === 0) return userText;
    const bodies = await loadWikiPageBodies(ctx.db, wikiRefs);
    const docLang = await resolveDocLanguage(ctx);
    return injectWikiRefsIntoUserContent(docLang, wikiRefs, bodies, userText);
  }

  async function streamAssistantReply(
    c: Context,
    session: IngestSession,
    runtime: Awaited<ReturnType<typeof sessionAgentRuntime>> | null,
    history: IngestSessionMessage[],
    llmUserContent: string,
    displayUserContent: string,
    wikiRefs: WikiRefInput[],
    assistantMsg: IngestSessionMessage,
    userMsg: IngestSessionMessage | null,
  ): Promise<Response> {
    let activeRuntime = runtime;
    if (!activeRuntime) {
      try {
        activeRuntime = await sessionAgentRuntime(ctx, session);
      } catch (error) {
        logSession(ctx.db, "stream_error", session.id, "Agent runtime 初始化失败", "failure", "api", {
          agent_kind: session.agent_kind,
          acp_agent_id: session.acp_agent_id,
          error: errorMessage(error),
        });
        return writeError(c, 400, runtimeErrorMessage(error));
      }
    }

    return streamSSE(c, async (stream) => {
      let chain: Promise<void> = Promise.resolve();
      const send = (event: string, payload: unknown) => {
        chain = chain.then(() =>
          stream.writeSSE({ event, data: JSON.stringify(payload) }).catch(() => undefined),
        );
      };

      if (userMsg) send("user_message", userMsg);
      send("assistant_start", { id: assistantMsg.id });

      const recorder = await createSessionMessageRecorder(ctx.db, assistantMsg.id);
      const sink = new SseEventSink(send, ctx.db, assistantMsg.id, recorder);
      const docLang = await resolveDocLanguage(ctx);

      let result: { text: string; stopReason: string } = { text: "", stopReason: "" };
      let promptError: unknown = null;
      try {
        result = await activeRuntime.prompt(
          {
            sessionId: session.id,
            mode: session.mode,
            docLang,
            userContent: llmUserContent,
            displayUserContent,
            history,
            wikiRefs,
            recorder,
          },
          sink,
          c.req.raw.signal,
        );
      } catch (error) {
        promptError = error;
      }

      const content = sink.flush();
      let streamStatus = streamStatusForStopReason(result.stopReason);
      if (promptError) {
        streamStatus =
          c.req.raw.signal.aborted || errorMessage(promptError).includes("cancel")
            ? "incomplete"
            : "failed";
      }
      let finalContent = content;
      if (!finalContent.trim() && streamStatus !== "incomplete") {
        streamStatus = "failed";
        finalContent = "LLM returned an empty response";
      }
      if (streamStatus === "failed" && promptError && !result.text.trim()) {
        finalContent = errorMessage(promptError);
      }

      await ctx.db.updateIngestSessionMessageContent(assistantMsg.id, finalContent, streamStatus);
      assistantMsg.content = finalContent;
      assistantMsg.stream_status = streamStatus;
      if (promptError) {
        logSession(ctx.db, "stream_error", session.id, errorMessage(promptError), "failure", "api", {
          agent_kind: session.agent_kind,
          stop_reason: result.stopReason,
          stream_status: streamStatus,
        });
      }
      if (promptError && !c.req.raw.signal.aborted) {
        send("error", { message: errorMessage(promptError) });
      }
      send("done", assistantMsg);
      await chain;
    });
  }

  async function streamSessionReply(
    c: Context,
    session: IngestSession,
    userContent: string,
    wikiRefs: WikiRefInput[],
  ): Promise<Response> {
    let runtime;
    try {
      runtime = await sessionAgentRuntime(ctx, session);
    } catch (error) {
      logSession(ctx.db, "stream_error", session.id, "Agent runtime 初始化失败", "failure", "api", {
        agent_kind: session.agent_kind,
        acp_agent_id: session.acp_agent_id,
        error: errorMessage(error),
      });
      return writeError(c, 400, runtimeErrorMessage(error));
    }
    if (session.agent_kind === KIND_ACP && ctx.acpMgr && !ctx.acpMgr.hasCapacity(session.id)) {
      c.header("Retry-After", "5");
      return writeError(c, 503, "ACP agent concurrency limit reached");
    }

    const history = await ctx.db.listIngestSessionMessages(session.id);
    if (sessionHasStreamingAssistant(history)) {
      return writeError(c, 409, "another message is still streaming");
    }

    const userMsg: IngestSessionMessage = {
      id: "",
      session_id: session.id,
      role: "user",
      content: userContent,
      message_type: "text",
      attachment_id: "",
      stream_status: "complete",
      wiki_refs_json: wikiRefsJsonFromInputs(wikiRefs),
      exclude_from_archive: false,
      created_at: "",
    };
    await ctx.db.createIngestSessionMessage(userMsg);
    recordSessionReferences(ctx.db, session.id, wikiRefs, "user_mention");

    const llmUserContent = await buildLlmUserContent(userContent, wikiRefs);

    const assistantMsg: IngestSessionMessage = {
      id: "",
      session_id: session.id,
      role: "assistant",
      content: "",
      message_type: "text",
      attachment_id: "",
      stream_status: "streaming",
      exclude_from_archive: false,
      created_at: "",
    };
    await ctx.db.createIngestSessionMessage(assistantMsg);
    return streamAssistantReply(
      c,
      session,
      runtime,
      history,
      llmUserContent,
      userContent,
      wikiRefs,
      assistantMsg,
      userMsg,
    );
  }

  function archiveResponseForReview(review: IngestReview) {
    return {
      review_id: review.id,
      status: review.status,
      source_path: review.archive_source_path,
      session_id: review.session_id,
      plan_job_id: "",
    };
  }

  async function archiveResponseWithJob(review: IngestReview) {
    const response = archiveResponseForReview(review);
    const job = await ctx.db.getIngestJobBySourceRef(reviewSourceRef(review.id), INPUT_KIND_REVIEW_PLAN);
    if (job) response.plan_job_id = job.id;
    return response;
  }

  async function tryReturnExistingArchive(c: Context, session: IngestSession): Promise<Response | null> {
    const existing = await ctx.db.getLatestIngestReviewBySessionID(session.id);
    if (session.status === "archived") {
      if (!existing) return writeError(c, 409, "session already archived");
      return writeJson(c, 200, await archiveResponseWithJob(existing));
    }
    if (existing && ["planning", "ready_for_review", "revising", "approved", "applying"].includes(existing.status)) {
      const job = await ctx.db.getIngestJobBySourceRef(reviewSourceRef(existing.id), INPUT_KIND_REVIEW_PLAN);
      if (!job) await enqueueReviewPlanJob(ctx.db, ctx.workspace, existing);
      return writeJson(c, 200, await archiveResponseWithJob(existing));
    }
    return null;
  }

  return {
    async createIngestSession(c: Context): Promise<Response> {
      if (!ctx.workspace.trim()) return writeError(c, 503, "workspace not configured for ingest");
      const req = (await readJsonBody<{
        title?: string;
        instance_id?: string;
        model?: string;
        mode?: string;
        agent_kind?: string;
        acp_agent_id?: string;
      }>(c)) ?? {};

      let instanceId = req.instance_id ?? "";
      let model = req.model ?? "";
      if (!instanceId) instanceId = await ctx.db.getConfig("last_instance_id");
      if (!model) model = await ctx.db.getConfig("last_model");

      let title = (req.title ?? "").trim();
      if (!title) {
        const count = await ctx.db.countIngestSessions();
        title = defaultIngestSessionTitle(count + 1, new Date());
      }
      const mode = req.mode || "ingest";
      let agentKind = req.agent_kind ?? "";
      if (!agentKind) agentKind = await ctx.db.getConfig("default_agent_kind");
      if (!agentKind) agentKind = KIND_NATIVE;
      let acpAgentId = req.acp_agent_id ?? "";
      if (!acpAgentId && agentKind === KIND_ACP) {
        acpAgentId = await ctx.db.getConfig("default_acp_agent_id");
      }
      try {
        await validateSessionAgent(agentKind, acpAgentId);
      } catch (error) {
        return writeError(c, 400, errorMessage(error));
      }
      const session: IngestSession = {
        id: "",
        title,
        status: "active",
        storage_path: "",
        llm_instance_id: instanceId,
        llm_model: model,
        mode,
        agent_kind: agentKind,
        acp_agent_id: acpAgentId,
        created_at: "",
        updated_at: "",
      };
      try {
        await ctx.db.createIngestSession(session);
        const rel = await ensureSessionDirs(ctx.workspace, session.id);
        session.storage_path = rel;
        await ctx.db.updateIngestSessionStoragePath(session.id, rel);
        await ctx.db.updateIngestSessionTitle(session.id, session.title);
        return writeJson(c, 201, { session });
      } catch (error) {
        return writeError(c, 500, errorMessage(error));
      }
    },

    async getIngestSession(c: Context): Promise<Response> {
      const session = await loadSession(c);
      if (session instanceof Response) return session;
      try {
        const review = await ctx.db.getLatestIngestReviewBySessionID(session.id);
        const activeReview =
          review && review.id && review.status !== "cancelled"
            ? {
                review_id: review.id,
                status: review.status,
                current_plan_version: review.current_plan_version,
                change_set_id: review.change_set_id,
              }
            : undefined;
        return writeJson(c, 200, { session, active_review: activeReview });
      } catch (error) {
        return writeError(c, 500, errorMessage(error));
      }
    },

    async listIngestSessions(c: Context): Promise<Response> {
      try {
        return writeJson(c, 200, { sessions: await ctx.db.listIngestSessions() });
      } catch (error) {
        return writeError(c, 500, errorMessage(error));
      }
    },

    async updateIngestSession(c: Context): Promise<Response> {
      const session = await loadSession(c);
      if (session instanceof Response) return session;
      const req = await readJsonBody<{
        instance_id?: string;
        model?: string;
        title?: string;
        mode?: string;
        agent_kind?: string;
        acp_agent_id?: string;
      }>(c);
      if (!req) return writeError(c, 400, "invalid request body");

      if (req.agent_kind !== undefined) {
        if (session.status === "archived") {
          return writeError(c, 409, "archived session cannot switch agent runtime");
        }
        const history = await ctx.db.listIngestSessionMessages(session.id);
        if (sessionHasStreamingAssistant(history)) {
          return writeError(c, 409, "another message is still streaming");
        }
        const kind = req.agent_kind.trim();
        const acpAgentId =
          req.acp_agent_id !== undefined ? req.acp_agent_id.trim() : session.acp_agent_id;
        try {
          await validateSessionAgent(kind, acpAgentId);
        } catch (error) {
          return writeError(c, 400, errorMessage(error));
        }
      }

      let updated = false;
      try {
        if (req.instance_id || req.model) {
          await ctx.db.updateIngestSessionLLM(session.id, req.instance_id ?? "", req.model ?? "");
          if (req.instance_id) await ctx.db.setConfig("last_instance_id", req.instance_id);
          if (req.model) await ctx.db.setConfig("last_model", req.model);
          updated = true;
        }
        if (req.title) {
          await ctx.db.updateIngestSessionTitle(session.id, req.title);
          updated = true;
        }
        if (req.mode) {
          if (!["ingest", "qa", "organize"].includes(req.mode)) {
            return writeError(c, 400, "invalid mode, must be one of: ingest, qa, organize");
          }
          await ctx.db.updateIngestSessionMode(session.id, req.mode);
          updated = true;
        }
        if (req.agent_kind !== undefined) {
          let kind = req.agent_kind.trim();
          let acpAgentId =
            req.acp_agent_id !== undefined ? req.acp_agent_id.trim() : session.acp_agent_id;
          if (kind === KIND_NATIVE) acpAgentId = "";
          await ctx.db.updateIngestSessionAgent(session.id, kind, acpAgentId);
          await ctx.db.setConfig("default_agent_kind", kind);
          await ctx.db.setConfig("default_acp_agent_id", acpAgentId);
          updated = true;
        }
      } catch (error) {
        return writeError(c, 500, errorMessage(error));
      }
      if (!updated) return writeError(c, 400, "no fields to update");
      const refreshed = await ctx.db.getIngestSession(session.id);
      return writeJson(c, 200, { session: refreshed });
    },

    async deleteIngestSession(c: Context): Promise<Response> {
      const session = await loadSession(c);
      if (session instanceof Response) return session;
      try {
        await ctx.db.deleteIngestSession(session.id);
        if (ctx.acpMgr) ctx.acpMgr.closeSession(session.id);
        if (ctx.workspace) await removeSessionDir(ctx.workspace, session.id);
        return writeJson(c, 200, { status: "deleted" });
      } catch (error) {
        if (errorMessage(error).includes("not found")) return writeError(c, 404, "session not found");
        return writeError(c, 500, errorMessage(error));
      }
    },

    async listIngestSessionMessages(c: Context): Promise<Response> {
      const session = await loadSession(c);
      if (session instanceof Response) return session;
      try {
        return writeJson(c, 200, { messages: await ctx.db.listIngestSessionMessages(session.id) });
      } catch (error) {
        return writeError(c, 500, errorMessage(error));
      }
    },

    async appendIngestSessionMessage(c: Context): Promise<Response> {
      if (!ctx.workspace.trim()) return writeError(c, 503, "workspace not configured for ingest");
      const session = await loadSession(c);
      if (session instanceof Response) return session;
      const req = await readJsonBody<{ content?: string; wiki_refs?: WikiRefRequest[] }>(c);
      if (!req) return writeError(c, 400, "invalid request body");
      if (!(req.content ?? "").trim()) return writeError(c, 400, "content is required");

      let wikiRefs: WikiRefInput[];
      try {
        wikiRefs = await parseWikiRefRequests(ctx, req.wiki_refs ?? []);
      } catch (error) {
        return writeError(c, 400, errorMessage(error));
      }
      try {
        if (isStreamRequest(c)) {
          return await streamSessionReply(c, session, req.content ?? "", wikiRefs);
        }
        const userMsg: IngestSessionMessage = {
          id: "",
          session_id: session.id,
          role: "user",
          content: req.content ?? "",
          message_type: "text",
          attachment_id: "",
          stream_status: "complete",
          wiki_refs_json: wikiRefsJsonFromInputs(wikiRefs),
          exclude_from_archive: false,
          created_at: "",
        };
        await ctx.db.createIngestSessionMessage(userMsg);
        recordSessionReferences(ctx.db, session.id, wikiRefs, "user_mention");
        return writeJson(c, 201, { message: userMsg });
      } catch (error) {
        return writeError(c, 500, errorMessage(error));
      }
    },

    async retryIngestSessionMessage(c: Context): Promise<Response> {
      if (!ctx.workspace.trim()) return writeError(c, 503, "workspace not configured for ingest");
      const session = await loadSession(c);
      if (session instanceof Response) return session;
      if (!isStreamRequest(c)) return writeError(c, 400, "streaming is required for retry");
      const messageId = c.req.param("messageId") ?? "";
      try {
        const assistantMsg = await ctx.db.getIngestSessionMessage(messageId);
        if (!assistantMsg || assistantMsg.session_id !== session.id) {
          return writeError(c, 404, "message not found");
        }
        if (assistantMsg.role !== "assistant") {
          return writeError(c, 400, "only assistant messages can be retried");
        }
        if (assistantMsg.stream_status !== "failed" && assistantMsg.stream_status !== "incomplete") {
          return writeError(c, 400, "message is not in a retriable state");
        }
        const history = await ctx.db.listIngestSessionMessages(session.id);
        if (sessionHasStreamingAssistant(history)) {
          return writeError(c, 409, "another message is still streaming");
        }
        const userMsg = findPairedUserMessage(history, assistantMsg.id);
        if (!userMsg || !userMsg.content.trim()) {
          return writeError(c, 400, "no user message found for retry");
        }
        await ctx.db.updateIngestSessionMessageContent(assistantMsg.id, "", "streaming");
        assistantMsg.content = "";
        assistantMsg.stream_status = "streaming";
        const filtered = filterHistoryForRetry(history, assistantMsg.id, userMsg.id);
        const wikiRefs = wikiRefsFromStoredJson(userMsg.wiki_refs_json ?? "");
        const llmUserContent = await buildLlmUserContent(userMsg.content, wikiRefs);
        return await streamAssistantReply(
          c,
          session,
          null,
          filtered,
          llmUserContent,
          userMsg.content,
          wikiRefs,
          assistantMsg,
          null,
        );
      } catch (error) {
        return writeError(c, 400, errorMessage(error));
      }
    },

    async patchIngestSessionMessage(c: Context): Promise<Response> {
      if (!ctx.workspace.trim()) return writeError(c, 503, "workspace not configured for ingest");
      const session = await loadSession(c);
      if (session instanceof Response) return session;
      const messageId = c.req.param("messageId") ?? "";
      try {
        const message = await ctx.db.getIngestSessionMessage(messageId);
        if (!message || message.session_id !== session.id) {
          return writeError(c, 404, "message not found");
        }
        const req = await readJsonBody<{ exclude_from_archive?: boolean }>(c);
        if (!req || req.exclude_from_archive === undefined) {
          return writeError(c, 400, "exclude_from_archive is required");
        }
        await ctx.db.updateIngestSessionMessageExclude(messageId, req.exclude_from_archive);
        message.exclude_from_archive = req.exclude_from_archive;
        return writeJson(c, 200, { message });
      } catch (error) {
        return writeError(c, 500, errorMessage(error));
      }
    },

    async getSessionMessageEvents(c: Context): Promise<Response> {
      const sessionId = c.req.param("id") ?? "";
      const messageId = c.req.param("messageId") ?? "";
      if (!sessionId || !messageId) return writeError(c, 400, "missing session or message id");
      try {
        const message = await ctx.db.getIngestSessionMessage(messageId);
        if (!message || message.session_id !== sessionId) {
          return writeError(c, 404, "message not found");
        }
        const limit = getIntQuery(c, "limit", 200);
        return writeJson(c, 200, { events: await ctx.db.listSessionMessageEvents(messageId, limit) });
      } catch (error) {
        return writeError(c, 500, errorMessage(error));
      }
    },

    async listIngestSessionReferences(c: Context): Promise<Response> {
      const session = await loadSession(c);
      if (session instanceof Response) return session;
      try {
        return writeJson(c, 200, { references: await ctx.db.listSessionReferences(session.id) });
      } catch (error) {
        return writeError(c, 500, errorMessage(error));
      }
    },

    async uploadIngestSessionAttachment(c: Context): Promise<Response> {
      if (!ctx.workspace.trim()) return writeError(c, 503, "workspace not configured for ingest");
      const session = await loadSession(c);
      if (session instanceof Response) return session;
      let form: FormData;
      try {
        form = await c.req.formData();
      } catch {
        return writeError(c, 400, "invalid multipart form");
      }
      const entries = [...form.getAll("file"), ...form.getAll("files")].filter(
        (entry): entry is File => typeof entry !== "string",
      );
      const file = entries[0];
      if (!file) return writeError(c, 400, "file is required");
      let data: Uint8Array;
      try {
        data = new Uint8Array(await file.arrayBuffer());
      } catch (error) {
        return writeError(c, 400, errorMessage(error));
      }
      try {
        const { attachmentId, relPath } = await writeSessionAttachment(
          ctx.workspace,
          session.id,
          file.name,
          data,
        );
        const summary = await summarizeAttachment(file.name, relPath, data);
        const message: IngestSessionMessage = {
          id: "",
          session_id: session.id,
          role: "assistant",
          content: summary,
          message_type: "attachment_summary",
          attachment_id: attachmentId,
          stream_status: "complete",
          exclude_from_archive: false,
          created_at: "",
        };
        await ctx.db.createIngestSessionMessage(message);
        return writeJson(c, 201, { attachment_id: attachmentId, path: relPath, message });
      } catch (error) {
        return writeError(c, 500, errorMessage(error));
      }
    },

    async archiveIngestSession(c: Context): Promise<Response> {
      if (!ctx.workspace.trim()) return writeError(c, 503, "workspace not configured for ingest");
      const session = await loadSession(c);
      if (session instanceof Response) return session;
      try {
        const count = await ctx.db.countUserSessionMessages(session.id);
        if (count === 0) return writeError(c, 400, "session has no user messages to archive");
        const existing = await tryReturnExistingArchive(c, session);
        if (existing) return existing;

        logSession(ctx.db, "archive_started", session.id, `会话 ${session.id} 开始归档`, "pending", "api");
        const req = (await readJsonBody<{ title?: string; deep_organize?: boolean }>(c)) ?? {};
        const title = (req.title ?? "").trim() || session.title || "ingest-session";
        const messages = await ctx.db.listIngestSessionMessages(session.id);
        const archiveMessages = messages
          .filter((message) => !message.exclude_from_archive)
          .map((message) => ({
            role: message.role,
            content: message.content,
            messageType: message.message_type,
            attachmentPath: message.attachment_id
              ? path.posix.join(sessionAttachmentsDir(session.id), message.attachment_id)
              : "",
          }));
        const sessionRefs = await ctx.db.listSessionReferences(session.id);
        const archiveRefs = sessionRefs.map((ref) => ({
          path: ref.relative_path,
          title: ref.title,
          source: ref.source,
        }));
        const now = new Date();
        const markdown = buildSessionArchiveMarkdown(
          session.id,
          title,
          session.mode,
          archiveMessages,
          archiveRefs,
          now,
        );
        const normalized = normalizeSessionArchive(
          session.id,
          title,
          markdown,
          `session:${session.id}`,
          now,
        );
        await writeFileBytesFirst(ctx, normalized.canonicalPath, normalized.content);

        const review: IngestReview = {
          id: "",
          session_id: session.id,
          archive_source_path: normalized.canonicalPath,
          status: "planning",
          current_plan_version: 0,
          approved_plan_version: 0,
          created_at: "",
          updated_at: "",
          deep_organize: Boolean(req.deep_organize),
        };
        try {
          await ctx.db.createIngestReview(review);
          const planJob = await enqueueReviewPlanJob(ctx.db, ctx.workspace, review);
          await ctx.db.updateIngestSessionStatusAndTitle(session.id, "archived", title);
          record(ctx.db, {
            level: "info",
            category: "ingest",
            action: "review_created",
            message: "归档审阅已创建，等待计划生成",
            resourceType: "review",
            resourceId: review.id,
            status: "pending",
            source: "api",
            details: { session_id: session.id, plan_job_id: planJob.id },
          });
          if (ctx.acpMgr) ctx.acpMgr.closeSession(session.id);
          return writeJson(c, 201, {
            review_id: review.id,
            status: review.status,
            source_path: normalized.canonicalPath,
            session_id: session.id,
            plan_job_id: planJob.id,
          });
        } catch (error) {
          await removeWorkspaceFile(ctx, normalized.canonicalPath);
          logSession(ctx.db, "archive_failed", session.id, errorMessage(error), "failure", "api");
          return writeError(c, 500, errorMessage(error));
        }
      } catch (error) {
        logSession(ctx.db, "archive_failed", session.id, errorMessage(error), "failure", "api");
        return writeError(c, 500, errorMessage(error));
      }
    },
  };

  async function summarizeAttachment(filename: string, relPath: string, data: Uint8Array): Promise<string> {
    const extracted = extractAttachmentText(filename, data);
    const instanceId = await ctx.db.getConfig("last_instance_id");
    const model = await ctx.db.getConfig("last_model");
    let client;
    try {
      client = instanceId && model ? await clientFromInstance(ctx.db, instanceId, model) : null;
    } catch {
      client = null;
    }
    if (!client) {
      if (extracted) {
        return `已上传附件 **${filename}**。\n\n提取内容摘要：\n${truncateRunes(extracted, 500)}`;
      }
      return `已上传附件 **${filename}**（路径：\`${relPath}\`）。请在对话中说明你想如何从该文件沉淀知识。`;
    }
    const docLang = await resolveDocLanguage(ctx);
    const prompt = attachmentSummaryPrompt(filename, extracted, docLang);
    const langName = docLang === "en" ? "English" : "Chinese";
    try {
      let summary = "";
      for await (const event of client.streamChat(
        [
          {
            role: "system",
            content: `You help summarize uploaded files for a personal wiki ingest session. Reply in ${langName}.`,
          },
          { role: "user", content: prompt },
        ],
        0.3,
        512,
      )) {
        if (event.type === "token") summary += event.content ?? "";
      }
      return summary || `已上传附件 **${filename}**（\`${relPath}\`）。`;
    } catch (error) {
      return `已上传 **${filename}**，但理解失败：${errorMessage(error)}`;
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
