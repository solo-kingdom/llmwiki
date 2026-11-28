import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import path from "node:path";
import { logIngestJob, logSession, record } from "../activity/index.js";
import { CanonicalPageConflictError } from "../engine/canonical.js";
import { refreshFolderOverviews } from "../engine/folder_overview.js";
import { folderPathFromWikiRelPath } from "../engine/wiki_org.js";
import { ArchiveStorageService } from "../archive/storage.js";
import { clientFromInstance } from "../llm/instance_client.js";
import type { Client } from "../llm/client.js";
import { logger } from "../logger.js";
import { notifyHelaEventAsync } from "../notify/hela.js";
import { McpRegistry } from "../mcp/registry.js";
import { toolLoopConfigForModeFromStore } from "../mcp/tool_loop_settings.js";
import { McpRouter } from "../mcp/router.js";
import type { Store } from "../store/interfaces.js";
import {
  DEFAULT_JOB_EVENTS_MAX_COUNT,
  type IngestJob,
  type IngestReview,
} from "../store/types.js";
import { NoWikiFilesWrittenError } from "./fileblocks.js";
import { computeRulesHash, loadWorkspaceRules } from "./prompts.js";
import { normalizeJobSource } from "./normalize.js";
import { PagePlanReviewRequiredError } from "./page_plan.js";
import { PageLockManager } from "./lock.js";
import { Pipeline } from "./pipeline.js";
import { formatFeedbackForPlan, parseReviewIdFromRef, reviewSourceRef } from "./review.js";
import { createJobRecorder, StoreJobRecorder } from "./job_events.js";
import { rebuildDerived } from "./rebuild.js";
import type { ApplyWikiResult } from "./types.js";

const STALE_HEARTBEAT_SECONDS = 120;

export interface JobProcessorOptions {
  /** Share the HTTP API's page lock manager so edits and job writes exclude each other. */
  lockManager?: PageLockManager;
  /** Replaces the per-job pipeline; tests use it to run jobs without a model. */
  createPipeline?: (lockManager: PageLockManager) => Pipeline;
}

export class JobProcessor {
  private readonly lockManager: PageLockManager;
  private readonly createPipeline: (lockManager: PageLockManager) => Pipeline;
  private readonly runnerId: string;
  private running = false;
  private timer: NodeJS.Timeout | null = null;
  private readonly inFlight = new Set<Promise<void>>();
  private dispatchTask: Promise<void> | null = null;

  constructor(
    private readonly db: Store,
    private readonly workspace: string,
    options: JobProcessorOptions = {},
  ) {
    this.lockManager = options.lockManager ?? new PageLockManager();
    this.createPipeline =
      options.createPipeline ?? ((lockManager) => new Pipeline(workspace, db, null, lockManager));
    this.runnerId = `${hostname() || "local"}-${process.pid}-${randomUUID().slice(0, 8)}`;
  }

  start(pollIntervalMs = 3000): void {
    if (this.running) return;
    this.running = true;
    void this.recoverStaleJobs();
    // The timer only tops up idle worker slots; a finished job triggers the next claim itself.
    this.timer = setInterval(() => void this.dispatch(), pollIntervalMs > 0 ? pollIntervalMs : 3000);
    void this.dispatch();
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Resolves once no job or claim loop started by this processor is still running. */
  async idle(): Promise<void> {
    while (this.inFlight.size > 0 || this.dispatchTask) {
      await Promise.allSettled([...this.inFlight, this.dispatchTask].filter(Boolean));
    }
  }

  async processAll(): Promise<void> {
    for (;;) {
      try {
        await this.processNext();
      } catch (error) {
        if (errorMessage(error).includes("no queued jobs")) return;
        throw error;
      }
    }
  }

  /** Claims and runs the next job on the caller's path; `start` goes through `dispatch` instead. */
  async processNext(): Promise<void> {
    const job = await this.db.claimNextIngestJob(this.runnerId);
    if (!job) throw new Error("no queued jobs");
    await this.processJob(job);
  }

  /**
   * Claims jobs while a worker slot is free. Single-flight, so two triggers cannot both decide
   * the same slot is free; the store's concurrency cap still guards against other runners.
   */
  private dispatch(): Promise<void> {
    if (this.dispatchTask) return this.dispatchTask;
    const task = this.claimLoop().finally(() => {
      this.dispatchTask = null;
    });
    this.dispatchTask = task;
    return task;
  }

  private async claimLoop(): Promise<void> {
    try {
      while (this.running) {
        if (this.inFlight.size >= (await this.workerLimit())) return;
        const job = await this.db.claimNextIngestJob(this.runnerId);
        if (!job) return;
        const task = this.processJob(job)
          .catch((error) => logger.error({ error, jobId: job.id }, "ingest processor: job failed outside the pipeline"))
          .finally(() => {
            this.inFlight.delete(task);
            void this.dispatch();
          });
        this.inFlight.add(task);
      }
    } catch (error) {
      logger.error({ error }, "ingest processor: dispatch");
      notifyHelaEventAsync(this.db, {
        type: "server_error",
        title: "[llmwiki] 摄入调度循环异常",
        content: `JobProcessor claimLoop 发生异常：\n\n- 错误：${errorMessage(error)}`,
        dedupeKey: `server_error:claim_loop:${errorMessage(error).slice(0, 80)}`,
      });
    }
  }

  /** Parallel processing is opt-in; anything unexpected falls back to one job at a time. */
  private async workerLimit(): Promise<number> {
    try {
      if (!(await this.db.parallelEnabled())) return 1;
      return Math.max(1, await this.db.maxConcurrentJobs());
    } catch {
      return 1;
    }
  }

  private async processJob(job: IngestJob): Promise<void> {
    // One pipeline per job: it holds per-job state (recorder, model, change set) and cannot be shared.
    const pipeline = this.createPipeline(this.lockManager);
    logIngestJob(this.db, job, "running", "processor");

    const recorder = await createJobRecorder(this.db, job.id);
    pipeline.setJobRecorder(recorder);
    // Ingest steps previously always fell back to built-in round defaults (4/5/8),
    // ignoring session_tool_loop_max_rounds_ingest; reasoning providers need the configured budget.
    pipeline.setToolLoopConfig(await toolLoopConfigForModeFromStore("", this.db));
    const stopHeartbeat = this.startHeartbeat(job.id);
    try {
      if (job.input_type === "rollback") {
        await this.processRollbackJob(job);
        return;
      }
      if (job.input_type === "review_plan") {
        await this.processReviewPlanJob(pipeline, job);
        return;
      }
      if (job.input_type === "review_apply") {
        await this.processReviewApplyJob(pipeline, job);
        return;
      }

      let normalized;
      try {
        normalized = await this.loadJobSource(job);
      } catch (error) {
        await this.failJob(job.id, "normalize_failed", `normalization failed: ${errorMessage(error)}`, "", "");
        return;
      }

      if (!(await this.preparePipelineForJob(pipeline, job))) return;
      pipeline.setChangeSetMeta(
        "ingest",
        job.id,
        "",
        path.basename(normalized.canonicalPath),
        new TextDecoder().decode(normalized.content),
        job.archive_file_id ?? "",
      );
      pipeline.setMcpRouter(null);
      await this.checkRulesDrift(pipeline, job.id);

      try {
        const files = await pipeline.ingestNormalized(normalized);
        await this.finalizeWikiApply(job.id, job.source_path, "", { written: files, deleted: [] });
        await this.markJobSucceeded(job.id, files);
      } catch (error) {
        const code = classifyPipelineError(error);
        let remediation = remediationForCode(code);
        let message = errorMessage(error);
        if (error instanceof PagePlanReviewRequiredError && error.plan) {
          const reviewId = await this.createAutoReviewFromPlan(job, error.plan).catch(() => "");
          if (reviewId) {
            remediation = `review ${reviewId} created; inspect and approve it via /api/v1/ingest/reviews/${reviewId}`;
            message = `${message} (review_id=${reviewId})`;
          }
        }
        await this.failJob(job.id, code, message, "", remediation);
      }
    } finally {
      stopHeartbeat();
      await this.db.clearIngestJobLease(job.id).catch(() => undefined);
      pipeline.setJobRecorder(null);
    }
  }

  private async createAutoReviewFromPlan(
    job: IngestJob,
    plan: import("./page_plan.js").AnalysisPagePlan,
  ): Promise<string> {
    if (
      typeof this.db.createIngestReview !== "function" ||
      typeof this.db.createIngestReviewPlan !== "function"
    ) {
      return "";
    }
    const review: IngestReview = {
      id: "",
      session_id: "",
      archive_source_path: job.source_path,
      archive_file_id: job.archive_file_id ?? "",
      status: "ready_for_review",
      current_plan_version: 1,
      approved_plan_version: 0,
      created_at: "",
      updated_at: "",
      deep_organize: false,
    };
    await this.db.createIngestReview(review);
    const changes = plan.pages.map((p) => ({
      path: p.path,
      action: p.action,
      rationale: p.reuse_reason || `${p.type}: ${p.title}`,
    }));
    const lines = [
      `# 自动转入审阅：${plan.summary || job.source_path}`,
      "",
      `来源作业 \`${job.id}\` 因新增页数超过直写阈值自动转为审阅：`,
      "",
      ...plan.pages.map(
        (p) => `- **${p.action}** \`${p.path}\` [${p.type}] — ${p.title}${p.reuse_reason ? `（复用理由：${p.reuse_reason}）` : ""}`,
      ),
    ];
    if (plan.proposed_folders && plan.proposed_folders.length > 0) {
      lines.push("", "## 提议新建目录", "");
      for (const f of plan.proposed_folders) {
        lines.push(`- \`wiki/${f.path}/\` (${f.display_name}) — ${f.description}`);
      }
    }
    await this.db.createIngestReviewPlan({
      id: "",
      review_id: review.id,
      version: 1,
      plan_markdown: lines.join("\n"),
      plan_json: JSON.stringify({ summary: plan.summary, changes, proposed_folders: plan.proposed_folders ?? [] }),
      created_at: "",
    });
    this.logReviewEvent(review.id, "", "review_ready", `auto-created review from job ${job.id}`, "success");
    return review.id;
  }

  private async loadJobSource(
    job: IngestJob,
    inputTypeOverride?: string,
    reviewArchiveFileId?: string,
  ) {
    const archiveId = (job.archive_file_id || reviewArchiveFileId || "").trim();
    if (archiveId && typeof this.db.getArchiveFile === "function") {
      const archiveFile = await this.db.getArchiveFile(archiveId);
      if (archiveFile) {
        const content = await new ArchiveStorageService(this.db, this.workspace).readFullBytes(archiveFile);
        const kind = (inputTypeOverride ?? job.input_type).trim() || "file";
        return {
          kind: (kind === "review_plan" || kind === "review_apply" ? "session_archive" : kind) as
            | "upload"
            | "text"
            | "conversation"
            | "session_archive",
          canonicalPath: archiveFile.relative_path,
          originalName: archiveFile.filename,
          sourceRef: job.source_ref,
          content,
        };
      }
    }
    return normalizeJobSource(this.workspace, inputTypeOverride ?? job.input_type, job.source_path, job.source_ref);
  }

  private async markJobSucceeded(jobId: string, files: string[]): Promise<void> {
    const summary = `generated ${files.length} wiki page(s)`;
    try {
      await this.db.markIngestJobSucceeded(jobId, summary);
    } catch (error) {
      logger.error({ error, jobId }, "processor: failed to mark job succeeded");
    }
    const updated = await this.db.getIngestJob(jobId);
    if (updated) {
      logIngestJob(this.db, updated, "succeeded", "processor");
      this.logSessionArchiveOutcome(updated, "archive_succeeded", "success");
    }
  }

  private async recoverStaleJobs(): Promise<void> {
    let ids: string[] = [];
    try {
      ids = await this.db.recoverStaleRunningJobs();
    } catch (error) {
      logger.error({ error }, "ingest processor: recover stale");
      return;
    }
    for (const id of ids) {
      const recorder = await createJobRecorder(this.db, id);
      recorder.record("system", "stale_recovered", "job requeued after heartbeat timeout", {
        threshold_seconds: STALE_HEARTBEAT_SECONDS,
      });
    }
    if (ids.length > 0) {
      notifyHelaEventAsync(this.db, {
        type: "server_error",
        title: `[llmwiki] 恢复 ${ids.length} 个心跳超时任务`,
        content: `检测到心跳超时（>${STALE_HEARTBEAT_SECONDS}s），已重新入队以下任务：\n\n- ${ids.join(", ")}`,
        dedupeKey: `server_error:stale_recovered:${ids.join(",")}`,
      });
    }
  }

  private startHeartbeat(jobId: string): () => void {
    const timer = setInterval(() => {
      void this.db
        .touchIngestJobHeartbeat(jobId, this.runnerId)
        .catch((error) => logger.error({ error, jobId }, "ingest processor: heartbeat"));
    }, 30_000);
    return () => clearInterval(timer);
  }

  private async failJob(
    id: string,
    errorCode: string,
    message: string,
    missingDep: string,
    remediation: string,
  ): Promise<void> {
    await this.db.clearIngestJobLease(id).catch(() => undefined);
    await this.db.updateIngestJobFailure(id, errorCode, message, missingDep, remediation);
    const failed = await this.db.getIngestJob(id);
    if (!failed) return;
    logIngestJob(this.db, failed, "failed", "processor");
    this.logSessionArchiveOutcome(failed, "archive_failed", "failure");
    const isReviewRequired = failed.error_code === "review_required";
    const summaryLines = [
      `- 任务 ID：\`${failed.id}\``,
      `- 类型：\`${failed.input_type}\``,
      failed.source_path ? `- 来源：\`${failed.source_path}\`` : "",
      failed.error_code ? `- 错误码：\`${failed.error_code}\`` : "",
      failed.error_message ? `- 详情：${failed.error_message}` : "",
      failed.remediation ? `- 建议：${failed.remediation}` : "",
    ].filter(Boolean);
    notifyHelaEventAsync(this.db, {
      type: isReviewRequired ? "review_required" : "ingest_failed",
      title: isReviewRequired
        ? `[llmwiki] 摄入转入人工审阅：${failed.source_path || failed.id}`
        : `[llmwiki] 摄入任务失败：${failed.source_path || failed.id}`,
      content: summaryLines.join("\n"),
      dedupeKey: `${isReviewRequired ? "review" : "ingest"}:${failed.id}:${failed.error_code || "failed"}`,
    });
    if (failed.input_type === "rollback") {
      const changeSetId = failed.source_ref;
      record(this.db, {
        level: "error",
        category: "history",
        action: "rollback_failed",
        message: `回滚失败：${changeSetId}`,
        resourceType: "change_set",
        resourceId: changeSetId,
        status: "failure",
        source: "processor",
        details: {
          change_set_id: changeSetId,
          job_id: failed.id,
          error: failed.error_message,
        },
      });
    }
  }

  private logSessionArchiveOutcome(job: IngestJob, action: string, status: string): void {
    if (job.input_type !== "session_archive" || !job.source_ref.startsWith("session:")) return;
    const sessionId = job.source_ref.slice("session:".length);
    const message =
      action === "archive_succeeded"
        ? `会话 ${sessionId} 归档成功`
        : `会话 ${sessionId} 归档失败`;
    logSession(this.db, action, sessionId, message, status, "processor", {
      job_id: job.id,
      error: job.error_message,
    });
  }

  private async preparePipelineForJob(pipeline: Pipeline, job: IngestJob): Promise<boolean> {
    try {
      const client = await this.resolveLLMClientForJob(job);
      pipeline.setLLMClient(client);
    } catch (error) {
      await this.failJob(job.id, "llm_config_invalid", errorMessage(error), "", remediationForCode("llm_config_invalid"));
      return false;
    }
    await this.attachMCPRouter(pipeline);
    pipeline.setDocLanguage(await resolveDocLang(this.db));
    pipeline.setWorkspaceRules(await loadWorkspaceRules(this.db));
    return true;
  }

  private async preparePipelineForReviewJob(
    pipeline: Pipeline,
    job: IngestJob,
    review: IngestReview,
  ): Promise<boolean> {
    try {
      const client = await this.resolveLLMClientForReview(review);
      pipeline.setLLMClient(client);
    } catch (error) {
      await this.failJob(job.id, "llm_config_invalid", errorMessage(error), "", remediationForCode("llm_config_invalid"));
      return false;
    }
    await this.attachMCPRouter(pipeline);
    pipeline.setDocLanguage(await resolveDocLang(this.db));
    pipeline.setWorkspaceRules(await loadWorkspaceRules(this.db));
    return true;
  }

  async checkRulesDrift(pipeline: Pipeline, jobId: string): Promise<void> {
    const recorder = pipeline.currentRecorder();
    if (!recorder) return;
    const current = computeRulesHash(await loadWorkspaceRules(this.db));
    const snapshot = await queuedRulesHash(this.db, jobId);
    if (snapshot && snapshot !== current) {
      recorder.record("system", "info", "rules_drift: workspace rules changed since job was queued", {
        rules_hash_snapshot: snapshot,
        rules_hash_current: current,
      });
    }
  }

  private async attachMCPRouter(pipeline: Pipeline): Promise<void> {
    try {
      const raw = await this.db.getConfig("mcp_servers_json");
      const registry = new McpRegistry(raw);
      const router = new McpRouter(registry, {
        recordMCP: (step, phase, message, payload) => {
          pipeline.currentRecorder()?.record(step, phase, message, payload);
        },
      });
      pipeline.setMcpRouter(router);
    } catch {
      pipeline.setMcpRouter(null);
    }
  }

  private async resolveLLMClientForJob(job: IngestJob): Promise<Client> {
    if (job.input_type === "session_archive" && job.source_ref.startsWith("session:")) {
      const session = await this.db.getIngestSession(job.source_ref.slice("session:".length));
      if (session?.llm_instance_id && session.llm_model) {
        return clientFromInstance(this.db, session.llm_instance_id, session.llm_model);
      }
    }
    const { instanceId, model } = await this.resolveJobInstanceAndModel();
    if (instanceId && model) return clientFromInstance(this.db, instanceId, model);
    throw new Error(
      "provider instance and model are not configured; set them in Settings under Provider instances",
    );
  }

  private async resolveLLMClientForReview(review: IngestReview): Promise<Client> {
    if (review.session_id) {
      const session = await this.db.getIngestSession(review.session_id);
      if (session?.llm_instance_id && session.llm_model) {
        return clientFromInstance(this.db, session.llm_instance_id, session.llm_model);
      }
    }
    const { instanceId, model } = await this.resolveJobInstanceAndModel();
    if (instanceId && model) return clientFromInstance(this.db, instanceId, model);
    throw new Error(
      "provider instance and model are not configured; set them in Settings under Provider instances",
    );
  }

  private async resolveJobInstanceAndModel(): Promise<{ instanceId: string; model: string }> {
    const jobInstanceId = (await this.db.getConfig("job_instance_id")).trim();
    const jobModel = (await this.db.getConfig("job_model")).trim();
    if (jobInstanceId) {
      let model = jobModel;
      if (!model) {
        const inst = await this.db.getProviderInstance(jobInstanceId);
        model = inst?.models[0] ?? "";
      }
      return { instanceId: jobInstanceId, model };
    }
    const lastInstanceId = (await this.db.getConfig("last_instance_id")).trim();
    const lastModel = (await this.db.getConfig("last_model")).trim();
    return { instanceId: lastInstanceId, model: jobModel || lastModel };
  }

  private async finalizeWikiApply(
    jobId: string,
    archivePath: string,
    planJson: string,
    result: ApplyWikiResult,
  ): Promise<void> {
    void archivePath;
    void planJson;
    const affectedFolders = [
      ...new Set(
        [...result.written, ...result.deleted]
          .map((p) => folderPathFromWikiRelPath(p))
          .filter(Boolean),
      ),
    ];
    if (affectedFolders.length > 0 && typeof this.db.listFolders === "function") {
      await refreshFolderOverviews(this.db, affectedFolders).catch((error) => {
        logger.warn({ error, jobId }, "processor: refresh folder overviews failed");
      });
    }
    if (
      affectedFolders.length > 0 &&
      typeof this.db.getIngestJob === "function" &&
      typeof this.db.getArchiveFile === "function" &&
      typeof this.db.updateArchiveFileLocation === "function"
    ) {
      try {
        const job = await this.db.getIngestJob(jobId);
        if (job?.archive_file_id) {
          const af = await this.db.getArchiveFile(job.archive_file_id);
          const targetFolder = affectedFolders[0]!;
          if (af && (!af.folder_path || af.folder_path === "ingest" || af.folder_path.startsWith("ingest/"))) {
            await this.db.updateArchiveFileLocation(af.id, targetFolder, af.filename);
            if (typeof this.db.getFolder === "function" && typeof this.db.updateArchiveFolder === "function") {
              const wf = await this.db.getFolder(targetFolder);
              if (wf && (wf.display_name || wf.description)) {
                await this.db.updateArchiveFolder(targetFolder, {
                  display_name: wf.display_name || undefined,
                  description: wf.description || undefined,
                  sort_order: wf.sort_order,
                });
              }
            }
          }
        }
      } catch (error) {
        logger.warn({ error, jobId }, "processor: align archive folder failed");
      }
    }
    const recorder = new StoreJobRecorder(this.db, jobId, DEFAULT_JOB_EVENTS_MAX_COUNT);
    recorder.record(
      "post_apply",
      "complete",
      `applied ${result.written.length} page(s), deleted ${result.deleted.length}`,
      null,
    );
  }

  private async processRollbackJob(job: IngestJob): Promise<void> {
    const changeSetId = job.source_ref;
    if (!changeSetId) {
      await this.failJob(job.id, "rollback_context_missing", "no change set specified for rollback", "", "");
      return;
    }
    const target = await this.db.getChangeSet(changeSetId);
    if (!target) {
      await this.failJob(job.id, "rollback_context_missing", `change set ${changeSetId} not found`, "", "");
      return;
    }
    let rollback;
    try {
      rollback = await this.db.undoChangeSet(changeSetId, "rollback");
    } catch (error) {
      await this.failJob(job.id, "rollback_failed", `rollback failed: ${errorMessage(error)}`, "", "");
      return;
    }
    try {
      await rebuildDerived(this.db);
    } catch (error) {
      await this.failJob(job.id, "rollback_failed", `rebuild index after rollback: ${errorMessage(error)}`, "", "");
      return;
    }
    const summary = `rolled back change set ${changeSetId} (${rollback.page_count} page(s))`;
    await this.db.markIngestJobSucceeded(job.id, summary);
    const updated = await this.db.getIngestJob(job.id);
    if (updated) logIngestJob(this.db, updated, "succeeded", "processor");
    record(this.db, {
      level: "info",
      category: "history",
      action: "rollback_succeeded",
      message: `回滚成功：${changeSetId}`,
      resourceType: "change_set",
      resourceId: changeSetId,
      status: "success",
      source: "processor",
      details: {
        change_set_id: changeSetId,
        rollback_set_id: rollback.id,
        job_id: job.id,
        pages: rollback.page_count,
      },
    });
  }

  private async processReviewPlanJob(pipeline: Pipeline, job: IngestJob): Promise<void> {
    const reviewId = parseReviewIdFromRef(job.source_ref);
    if (!reviewId) {
      await this.failJob(job.id, "pipeline_error", "invalid review source_ref", "", "");
      return;
    }
    const review = await this.db.getIngestReview(reviewId);
    if (!review) {
      await this.failJob(job.id, "pipeline_error", "review not found", "", "");
      return;
    }
    if (!(await this.preparePipelineForReviewJob(pipeline, job, review))) return;
    pipeline.setMcpRouter(null);
    await this.checkRulesDrift(pipeline, job.id);

    let normalized;
    try {
      normalized = await this.loadJobSource(job, "session_archive", review.archive_file_id);
    } catch (error) {
      await this.failReviewPlanFailed(reviewId, job.id, "normalize_failed", error);
      return;
    }

    let feedback = await this.collectReviewFeedback(reviewId);
    if (review.deep_organize) {
      const deep = await this.collectDeepOrganizeContext();
      if (deep) feedback = `${feedback}\n\n${deep}`;
    }

    let plan;
    try {
      plan = await pipeline.planOnly(normalized, feedback);
    } catch (error) {
      await this.failReviewPlanFailed(reviewId, job.id, classifyPipelineError(error), error);
      return;
    }

    try {
      const version = await this.db.nextIngestReviewPlanVersion(reviewId);
      await this.db.createIngestReviewPlan({
        id: "",
        review_id: reviewId,
        version,
        plan_markdown: plan.planMarkdown,
        plan_json: plan.planJson,
        created_at: "",
      });
      await this.db.setIngestReviewPlanVersion(reviewId, version);
      await this.db.createIngestReviewMessage({
        id: "",
        review_id: reviewId,
        role: "assistant",
        message_type: "plan_summary",
        content: `Plan v${version} ready for review.`,
        created_at: "",
      });
      if (review.status === "revising" || review.status === "failed" || review.status === "planning") {
        await this.db.updateIngestReviewStatus(reviewId, "ready_for_review");
      }
      this.logReviewEvent(reviewId, review.session_id, "review_ready", "plan ready for review", "success");
      await this.db.markIngestJobSucceeded(job.id, `plan v${version} generated`);
    } catch (error) {
      await this.failReviewPlanFailed(reviewId, job.id, "pipeline_error", error);
    }
  }

  private async processReviewApplyJob(pipeline: Pipeline, job: IngestJob): Promise<void> {
    const reviewId = parseReviewIdFromRef(job.source_ref);
    if (!reviewId) {
      await this.failJob(job.id, "pipeline_error", "invalid review source_ref", "", "");
      return;
    }
    const review = await this.db.getIngestReview(reviewId);
    if (!review) {
      await this.failJob(job.id, "pipeline_error", "review not found", "", "");
      return;
    }
    if (review.approved_plan_version <= 0) {
      await this.failReviewApplyFailed(reviewId, job.id, "pipeline_error", new Error("no approved plan version"));
      return;
    }

    await this.db.updateIngestReviewStatus(reviewId, "applying");
    this.logReviewEvent(reviewId, review.session_id, "review_applying", "apply started", "pending");

    if (!(await this.preparePipelineForReviewJob(pipeline, job, review))) return;
    pipeline.setMcpRouter(null);
    await this.checkRulesDrift(pipeline, job.id);

    const plan = await this.db.getIngestReviewPlan(reviewId, review.approved_plan_version);
    if (!plan) {
      await this.failReviewApplyFailed(reviewId, job.id, "pipeline_error", new Error("approved plan not found"));
      return;
    }
    let normalized;
    try {
      normalized = await this.loadJobSource(job, "session_archive", review.archive_file_id);
    } catch (error) {
      await this.failReviewApplyFailed(reviewId, job.id, "normalize_failed", error);
      return;
    }

    const archiveFileId = job.archive_file_id || review.archive_file_id || "";
    pipeline.setChangeSetMeta(
      "review_apply",
      job.id,
      reviewId,
      path.basename(normalized.canonicalPath),
      new TextDecoder().decode(normalized.content),
      archiveFileId,
    );

    let result;
    try {
      result = await pipeline.applyFromPlan(normalized, plan.plan_json);
    } catch (error) {
      await this.failReviewApplyFailed(reviewId, job.id, classifyPipelineError(error), error);
      return;
    }
    if (result.written.length === 0 && result.deleted.length === 0) {
      await this.failReviewApplyFailed(reviewId, job.id, "no_wiki_files_written", new NoWikiFilesWrittenError());
      return;
    }

    await this.finalizeWikiApply(job.id, job.source_path, plan.plan_json, result);
    await this.db.setIngestReviewFinalJob(reviewId, job.id);
    const changeSetId = pipeline.lastChangeSetId();
    if (changeSetId) await this.db.setIngestReviewChangeSet(reviewId, changeSetId);

    const summary = `applied ${result.written.length} wiki page(s) from approved plan v${review.approved_plan_version}`;
    await this.db.markIngestJobSucceeded(job.id, summary);
    await this.db.updateIngestReviewStatus(reviewId, "succeeded");
    this.logReviewEvent(reviewId, review.session_id, "review_succeeded", summary, "success");
    if (review.session_id) {
      logSession(
        this.db,
        "archive_succeeded",
        review.session_id,
        `会话 ${review.session_id} 归档审核执行成功`,
        "success",
        "processor",
        { job_id: job.id, review_id: reviewId },
      );
    }
  }

  private async collectReviewFeedback(reviewId: string): Promise<string> {
    const messages = await this.db.listIngestReviewMessages(reviewId);
    const feedback: string[] = [];
    for (const message of messages) {
      if (message.message_type === "feedback" && message.role === "user" && message.content.trim()) {
        feedback.push(message.content);
      }
    }
    return formatFeedbackForPlan(feedback);
  }

  private async collectDeepOrganizeContext(): Promise<string> {
    const docs = await this.db.listDocuments();
    const wikiDocs = docs.filter((doc) => doc.source_kind === "wiki");
    if (wikiDocs.length === 0) return "";
    const pairs: string[] = [];
    const seen = new Set<string>();
    for (const doc of wikiDocs) {
      let query = doc.content;
      if ([...query].length > 500) query = [...query].slice(0, 500).join("");
      if (!query.trim()) continue;
      let results;
      try {
        results = await this.db.searchChunks(query, 5, "wiki");
      } catch {
        continue;
      }
      for (const result of results) {
        if (result.path === doc.relative_path || result.score < 0.3) continue;
        const [a, b] = [doc.relative_path, result.path].sort();
        const key = `${a}|${b}`;
        if (seen.has(key)) continue;
        seen.add(key);
        pairs.push(`- ${a} ⟷ ${b} (重叠度: ${result.score.toFixed(2)})`);
      }
    }
    if (pairs.length === 0) return "";
    return `## 深度整理：检测到 ${pairs.length} 对内容相似页面\n\n${pairs.join("\n")}\n\n请在计划中考虑合并这些相似页面，使用 merge action 并填写 source_paths 和 to_path。`;
  }

  private async failReviewPlanFailed(reviewId: string, jobId: string, code: string, error: unknown): Promise<void> {
    await this.db.updateIngestReviewStatus(reviewId, "failed");
    const review = await this.db.getIngestReview(reviewId);
    if (review) this.logReviewEvent(reviewId, review.session_id, "review_plan_failed", errorMessage(error), "failure");
    await this.failJob(jobId, code, errorMessage(error), "", remediationForCode(code));
  }

  private async failReviewApplyFailed(reviewId: string, jobId: string, code: string, error: unknown): Promise<void> {
    await this.db.updateIngestReviewStatus(reviewId, "failed");
    const review = await this.db.getIngestReview(reviewId);
    if (review) {
      this.logReviewEvent(reviewId, review.session_id, "review_apply_failed", errorMessage(error), "failure");
      if (review.session_id) {
        logSession(
          this.db,
          "archive_failed",
          review.session_id,
          `会话 ${review.session_id} 归档审核执行失败`,
          "failure",
          "processor",
          { job_id: jobId, review_id: reviewId, error: errorMessage(error) },
        );
      }
    }
    await this.failJob(jobId, code, errorMessage(error), "", remediationForCode(code));
  }

  private logReviewEvent(
    reviewId: string,
    sessionId: string,
    action: string,
    message: string,
    status: string,
  ): void {
    const details: Record<string, unknown> = { review_id: reviewId };
    if (sessionId) details.session_id = sessionId;
    record(this.db, {
      level: "info",
      category: "ingest",
      action,
      message,
      resourceType: "review",
      resourceId: reviewId,
      status,
      source: "processor",
      details,
    });
  }
}

export async function enqueueReviewPlanJob(
  db: Store,
  workspace: string,
  review: IngestReview,
): Promise<IngestJob> {
  const job: IngestJob = {
    id: "",
    parent_job_id: "",
    input_type: "review_plan",
    source_path: review.archive_source_path,
    source_ref: reviewSourceRef(review.id),
    archive_file_id: review.archive_file_id ?? "",
    status: "queued",
    retries: 0,
    max_retries: 3,
    error: "",
    error_code: "",
    error_message: "",
    missing_dependency: "",
    remediation: "",
    result_summary: "",
    created_at: "",
    updated_at: "",
  };
  await db.createIngestJob(job);
  await recordRulesSnapshot(db, job.id, workspace);
  logIngestJob(db, job, "queued", "api");
  return job;
}

export async function enqueueReviewApplyJob(
  db: Store,
  workspace: string,
  review: IngestReview,
): Promise<IngestJob> {
  const job: IngestJob = {
    id: "",
    parent_job_id: "",
    input_type: "review_apply",
    source_path: review.archive_source_path,
    source_ref: reviewSourceRef(review.id),
    archive_file_id: review.archive_file_id ?? "",
    status: "queued",
    retries: 0,
    max_retries: 3,
    error: "",
    error_code: "",
    error_message: "",
    missing_dependency: "",
    remediation: "",
    result_summary: "",
    created_at: "",
    updated_at: "",
  };
  await db.createIngestJob(job);
  await recordRulesSnapshot(db, job.id, workspace);
  logIngestJob(db, job, "queued", "api");
  return job;
}

export async function recordRulesSnapshot(db: Store, jobId: string, _workspace: string): Promise<void> {
  if (!jobId) return;
  const hash = computeRulesHash(await loadWorkspaceRules(db));
  let maxCount = DEFAULT_JOB_EVENTS_MAX_COUNT;
  try {
    const raw = await db.getConfig("ingest_job_events_max_count");
    if (raw) {
      const parsed = Number.parseInt(raw, 10);
      if (Number.isFinite(parsed)) maxCount = parsed;
    }
  } catch {
    maxCount = DEFAULT_JOB_EVENTS_MAX_COUNT;
  }
  await db.insertIngestJobEvent(jobId, "system", "queued", "rules snapshot", { rules_hash: hash }, maxCount);
}

async function queuedRulesHash(db: Store, jobId: string): Promise<string> {
  const events = await db.listIngestJobEvents(jobId, 50);
  for (const event of events) {
    if (event.step !== "system" || event.phase !== "queued" || !event.payload) continue;
    try {
      const payload = JSON.parse(event.payload) as { rules_hash?: string };
      if (payload.rules_hash) return payload.rules_hash;
    } catch {
      // ignore malformed payloads
    }
  }
  return "";
}

export async function resolveDocLang(db: Store): Promise<string> {
  const value = await db.getConfig("doc_language");
  return value === "zh" || value === "en" ? value : "zh";
}

export function classifyPipelineError(error: unknown): string {
  if (!error) return "";
  if (error instanceof PagePlanReviewRequiredError) return "review_required";
  if (error instanceof CanonicalPageConflictError) return "canonical_duplicate";
  const message = errorMessage(error);
  if (message.includes("analysis is empty") || message.includes("page plan")) return "invalid_page_plan";
  if (
    message.includes("unsupported protocol scheme") ||
    message.includes("base URL is not configured") ||
    message.includes("provider base URL")
  ) {
    return "llm_config_invalid";
  }
  if (message.includes("API key") || message.includes("unauthorized") || message.includes("401")) {
    return "llm_auth_failed";
  }
  if (message.includes("quota") || message.includes("429") || message.includes("rate limit")) {
    return "llm_rate_limited";
  }
  if (message.includes("timeout") || message.includes("deadline exceeded")) return "llm_timeout";
  if (message.includes("unsupported format") || message.includes("unsupported file")) return "unsupported_format";
  if (message.includes("analysis:") || message.includes("analysis tool loop") || message.includes("analyze")) {
    return "analysis_failed";
  }
  if (message.includes("generation:") || message.includes("generate")) return "generation_failed";
  if (error instanceof NoWikiFilesWrittenError || message.includes("no wiki files written")) {
    return "no_wiki_files_written";
  }
  return "pipeline_error";
}

export function remediationForCode(code: string): string {
  switch (code) {
    case "review_required":
      return "create a reviewed ingest session, confirm each page's reuse_reason, then apply the approved plan";
    case "canonical_duplicate":
      return "update the existing canonical page identified in the error instead of creating another path";
    case "invalid_page_plan":
      return "retry analysis with a non-empty structured page plan; generation/apply was not attempted";
    case "llm_config_invalid":
      return "configure Provider and base URL in Settings (Provider instances)";
    case "llm_auth_failed":
      return "check your API key in Settings";
    case "llm_rate_limited":
      return "wait a moment and retry, or reduce batch size";
    case "llm_timeout":
      return "the LLM request timed out; try again or use a smaller input";
    case "unsupported_format":
      return "convert the file to a supported format before uploading";
    case "analysis_failed":
    case "generation_failed":
      return "the LLM pipeline encountered an error; check the job error message and server logs";
    case "no_wiki_files_written":
      return "the model produced FILE blocks but none were written; replan or check job logs for invalid paths";
    default:
      return "";
  }
}

export { formatFeedbackForPlan };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
