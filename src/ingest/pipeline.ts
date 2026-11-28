import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Client } from "../llm/client.js";
import { defaultToolLoopConfig, runToolLoop } from "../llm/tools.js";
import type { Message, ToolLoopConfig } from "../llm/types.js";
import type { McpRouter } from "../mcp/router.js";
import type { Store } from "../store/interfaces.js";
import {
  CONFIG_STRUCTURE_POLICY_MODE,
  OPEN_AUTO_FOLDER_DOMAINS,
  parseStructurePolicyMode,
} from "../engine/placement_policy.js";
import { folderPathFromWikiRelPath, isCanonicalSlugSegment } from "../engine/wiki_org.js";
import { formatFolderTreeForPrompt } from "../mcp/diagnostic_tools.js";
import { IngestCache } from "./cache.js";
import { applyBlocksToStore } from "./dbapply.js";
import { NoWikiFilesWrittenError, normalizeWikiFileBlocks, normalizeWikiFilePath, parseFileBlocks, parseFileBlocksWithContent } from "./fileblocks.js";
import { llmMessagesForRecord, recordLLMRequest, recordLLMResponse, traceRetries } from "./job_events.js";
import { PageLockManager, withPageLocks } from "./lock.js";
import { normalizeUpload } from "./normalize.js";
import {
  assertBlocksMatchApprovedPlan,
  assertGenerationMatchesPagePlan,
  parseAnalysisPagePlan,
  validateAnalysisPagePlanAgainstStore,
  type AnalysisPagePlan,
} from "./page_plan.js";
import { composeSystemPrompt, computeRulesHash } from "./prompts.js";
import { formatFeedbackForPlan, parsePlanActions, parsePlanResult, sourcePathsToDelete } from "./review.js";
import {
  formatReferencedPagesForAnalysis,
  parseReferencedWikiPagesFromArchive,
  parseSessionModeFromArchive,
} from "./session_store.js";
import { PipelineMcpExecutor, PipelineToolExecutor } from "./tools.js";
import type {
  ApplyWikiBlocksOptions,
  ApplyWikiResult,
  JobRecorder,
  MergeContext,
  NormalizedSource,
  PlanResult,
  PromptContext,
  PromptStep,
  WikiRefInput,
} from "./types.js";

const EMPTY_MERGE: MergeContext = { llmClient: null, docLang: "zh", recorder: null };

export class Pipeline {
  private db: Store | null;
  private llmClient: Client | null;
  private readonly lockMgr: PageLockManager;
  private recorder: JobRecorder | null = null;
  private mcpExecutor: PipelineMcpExecutor | null = null;
  private toolLoopConfig: ToolLoopConfig | null = null;
  private docLang = "zh";
  private rulesSupplement = "";
  private workspacePurpose = "";
  private workspaceRules = "";
  private stepAppends: Record<string, string> = {};
  private forceOverwrite = false;
  private targetDir = "";
  private changeSetKind = "";
  private changeSetJobId = "";
  private changeSetReviewId = "";
  private archiveFileId = "";
  private sourceFilename = "";
  private normalizedContent = "";
  private lastChangeSetID = "";
  private readonly cache: IngestCache;

  constructor(
    private readonly workspace: string,
    db: Store | null,
    llmClient: Client | null,
    // Pipelines that may write the same page (concurrent jobs, the HTTP API) must share one manager.
    lockManager?: PageLockManager,
  ) {
    this.db = db;
    this.llmClient = llmClient;
    this.cache = new IngestCache(workspace, db);
    this.lockMgr = lockManager ?? new PageLockManager();
  }

  setDb(db: Store | null): void {
    this.db = db;
    (this as unknown as { cache: IngestCache }).cache = new IngestCache(this.workspace, db);
  }

  lastChangeSetId(): string {
    return this.lastChangeSetID;
  }

  setChangeSetMeta(
    kind: string,
    jobId: string,
    reviewId: string,
    sourceFilename: string,
    normalizedContent: string,
    archiveFileId = "",
  ): void {
    this.changeSetKind = kind;
    this.changeSetJobId = jobId;
    this.changeSetReviewId = reviewId;
    this.sourceFilename = sourceFilename;
    this.normalizedContent = normalizedContent;
    this.archiveFileId = archiveFileId;
  }

  setLLMClient(client: Client | null): void {
    this.llmClient = client;
  }

  setJobRecorder(recorder: JobRecorder | null): void {
    this.recorder = recorder;
  }

  currentRecorder(): JobRecorder | null {
    return this.recorder;
  }

  setMcpRouter(router: McpRouter | null): void {
    this.mcpExecutor = router && router.hasJobServers() ? new PipelineMcpExecutor(router) : null;
  }

  setToolLoopConfig(config: ToolLoopConfig): void {
    this.toolLoopConfig = config;
  }

  setDocLanguage(lang: string): void {
    this.docLang = lang;
  }

  setRulesSupplement(value: string): void {
    this.rulesSupplement = value;
  }

  setWorkspaceRules(rules: { purpose?: string; rules?: string; stepAppends?: Record<string, string>; supplement?: string }): void {
    if (rules.purpose !== undefined) this.workspacePurpose = rules.purpose;
    if (rules.rules !== undefined) this.workspaceRules = rules.rules;
    if (rules.stepAppends !== undefined) this.stepAppends = rules.stepAppends;
    if (rules.supplement !== undefined) this.rulesSupplement = rules.supplement;
  }

  setForceOverwrite(value: boolean): void {
    this.forceOverwrite = value;
  }

  setTargetDir(dir: string): void {
    this.targetDir = dir;
  }

  lockManager(): PageLockManager {
    return this.lockMgr;
  }

  private effectiveWorkspace(): string {
    return this.targetDir || this.workspace;
  }

  private applyOptions(): ApplyWikiBlocksOptions {
    return {
      forceOverwrite: this.forceOverwrite,
      merge: {
        llmClient: this.llmClient,
        docLang: this.docLang,
        recorder: this.recorder,
      },
    };
  }

  private promptContext(): PromptContext {
    return {
      workspace: this.workspace,
      docLang: this.docLang,
      rulesSupplement: this.rulesSupplement,
      workspacePurpose: this.workspacePurpose,
      workspaceRules: this.workspaceRules,
      stepAppends: this.stepAppends,
    };
  }

  async ingest(sourcePath: string): Promise<string[]> {
    const content = await readFile(sourcePath);
    const normalized = normalizeUpload(path.basename(sourcePath), content, "file");
    return this.ingestNormalized(normalized, [path.resolve(sourcePath)]);
  }

  async ingestNormalized(source: NormalizedSource, legacyKeys: string[] = []): Promise<string[]> {
    if (!source) throw new Error("normalized source is nil");
    if (!this.llmClient) throw new Error("LLM client not configured");

    const name = path.basename(source.canonicalPath);
    const content = new TextDecoder().decode(source.content);

    this.recorder?.record("normalize", "complete", "source normalized", {
      canonical_path: source.canonicalPath,
      input_type: source.kind,
    });

    const rulesHash = computeRulesHash({
      purpose: this.workspacePurpose,
      rules: this.workspaceRules,
      stepAppends: this.stepAppends,
      supplement: this.rulesSupplement,
    });
    const cached = await this.cache.lookupForSource(source, legacyKeys, rulesHash);
    if (cached) {
      this.recorder?.record("cache", "hit", "cache hit", {
        canonical_path: source.canonicalPath,
        paths_written: cached.written_files,
      });
      return cached.written_files;
    }

    const analysis = await this.analyze(name, content);
    const pagePlan = await this.validatedPagePlan(analysis);
    const files = await this.generate(name, content, analysis, pagePlan);
    this.recorder?.record("apply_files", "complete", "wiki files applied", { paths_written: files });
    await this.cache.saveForSource(source, files, rulesHash);
    return files;
  }

  async planOnly(source: NormalizedSource, feedback: string): Promise<PlanResult> {
    if (!source) throw new Error("normalized source is nil");
    if (!this.llmClient) throw new Error("LLM client not configured");
    const name = path.basename(source.canonicalPath);
    const content = new TextDecoder().decode(source.content);

    this.recorder?.record("plan", "start", "generating review plan", {
      canonical_path: source.canonicalPath,
    });
    const analysis = await this.analyze(name, content);
    await this.validatedPagePlan(analysis, false);
    const planRaw = await this.generatePlan(name, content, analysis, feedback);
    const result = parsePlanResult(planRaw);
    this.recorder?.record("plan", "complete", "review plan generated", {
      plan_chars: [...result.planMarkdown].length,
    });
    return result;
  }

  async applyFromPlan(
    source: NormalizedSource,
    planJson: string,
  ): Promise<ApplyWikiResult> {
    if (!source) throw new Error("normalized source is nil");
    if (!this.llmClient) throw new Error("LLM client not configured");
    const plan = planJson.trim();
    if (!plan) throw new Error("approved plan is empty");

    const name = path.basename(source.canonicalPath);
    const content = new TextDecoder().decode(source.content);
    this.recorder?.record("apply", "start", "regenerating FILE blocks from approved plan", null);

    const result = await this.generateFromPlan(name, content, "", plan);
    this.recorder?.record("apply_files", "complete", "wiki files applied from approved plan", {
      paths_written: result.written,
      paths_deleted: result.deleted,
    });
    return result;
  }

  private async folderTreeContext(): Promise<string> {
    if (!this.db) return "";
    try {
      const [folders, docs, storedMode] = await Promise.all([
        typeof this.db.listFolders === "function" ? this.db.listFolders(true) : Promise.resolve([]),
        this.db.listDocumentsFiltered({ source_kind: "wiki", exclude_hidden: true }),
        typeof this.db.getConfig === "function" ? this.db.getConfig(CONFIG_STRUCTURE_POLICY_MODE) : Promise.resolve(""),
      ]);
      const mode = parseStructurePolicyMode(storedMode);
      const summary = formatFolderTreeForPrompt(folders, docs, 80, mode);
      const guidance = mode === "legacy"
        ? "当前目录树（请优先复用已有匹配目录）"
        : "当前目录树（legacy 仅供存量 update；新页面只能选择非 legacy 的已登记主题域/主题组）";
      return summary ? `${guidance}：\n${summary}` : "";
    } catch {
      return "";
    }
  }

  private async analyze(name: string, content: string): Promise<string> {
    const system = composeSystemPrompt("analysis", this.promptContext());
    const treeCtx = await this.folderTreeContext();
    let userBody = `源文件：**${name}**\n\n---\n\n${content}`;
    if (treeCtx) userBody = `${treeCtx}\n\n---\n\n${userBody}`;
    const refs = parseReferencedWikiPagesFromArchive(content);
    if (refs.length > 0) {
      const note = formatReferencedPagesForAnalysis(this.docLang, refs);
      if (note) userBody = `${note}\n\n${userBody}`;
    }
    return this.runLLMStep(
      "analysis",
      [
        { role: "system", content: system },
        { role: "user", content: userBody },
      ],
      0.1,
      8192,
      { promptStep: "analysis" },
    );
  }

  private async validatedPagePlan(analysis: string, enforceReviewThreshold = true): Promise<AnalysisPagePlan> {
    const pagePlan = parseAnalysisPagePlan(analysis, { enforceReviewThreshold });
    await validateAnalysisPagePlanAgainstStore(pagePlan, this.db);
    if (pagePlan.proposed_folders && pagePlan.proposed_folders.length > 0 && this.db) {
      const existingFolders =
        typeof this.db.listFolders === "function" ? await this.db.listFolders(true) : [];
      const folderSet = new Set(existingFolders.map((f) => f.path));
      const needsReview: string[] = [];
      for (const proposed of pagePlan.proposed_folders) {
        if (folderSet.has(proposed.path)) continue;
        const [domain, group] = proposed.path.split("/");
        if (
          domain &&
          group &&
          OPEN_AUTO_FOLDER_DOMAINS.has(domain) &&
          isCanonicalSlugSegment(domain) &&
          isCanonicalSlugSegment(group) &&
          typeof this.db.createFolder === "function"
        ) {
          await this.db.createFolder({
            path: proposed.path,
            display_name: proposed.display_name,
            description: proposed.description,
          });
          folderSet.add(proposed.path);
          this.recorder?.record("analysis", "info", `auto-created open-domain folder: ${proposed.path}`, proposed as unknown as Record<string, unknown>);
        } else {
          needsReview.push(proposed.path);
        }
      }
      if (needsReview.length > 0 && enforceReviewThreshold) {
        const { PagePlanReviewRequiredError } = await import("./page_plan.js");
        throw new PagePlanReviewRequiredError(
          `提议新建非开放域目录 [${needsReview.join(", ")}]，必须转入 review 确认`,
          pagePlan,
        );
      }
    }
    this.recorder?.record("analysis", "complete", "validated analysis page plan", {
      page_count: pagePlan.pages.length,
      paths: pagePlan.pages.map((page) => page.path),
    });
    return pagePlan;
  }

  private async generate(
    name: string,
    content: string,
    analysis: string,
    pagePlan: AnalysisPagePlan,
  ): Promise<string[]> {
    const treeCtx = await this.folderTreeContext();
    const prompt = `源文件：**${name}**

${treeCtx ? `${treeCtx}\n\n` : ""}已验证 page plan（必须逐页遵循，不得增删页面、修改路径或类型）：
${JSON.stringify(pagePlan)}

分析（用于理解依据）：
${analysis}

原始内容：
${content}

请按 FILE 块格式生成 wiki 页面。`;
    const system = composeSystemPrompt("generation", this.promptContext());
    const result = await this.runLLMStep(
      "generation",
      [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
      0.1,
      32768,
      { promptStep: "generation" },
    );

    const parsed = parseFileBlocksWithContent(result);
    const normalized = normalizeWikiFileBlocks(parsed);
    if (normalized.adjustments.length > 0) {
      this.recorder?.record("apply_files", "warn", "normalized FILE paths", {
        adjustments: normalized.adjustments,
      });
    }
    assertGenerationMatchesPagePlan(normalized.blocks, pagePlan);
    const applied = await this.applyBlocksLocked(normalized.blocks);
    return applied.written;
  }

  private async generatePlan(
    name: string,
    content: string,
    analysis: string,
    feedback: string,
  ): Promise<string> {
    let planStep: PromptStep = "plan";
    let toolMode = "";
    const mode = parseSessionModeFromArchive(content);
    if (mode) {
      toolMode = mode;
      if (mode === "organize") planStep = "plan_organize";
      else if (mode === "qa") planStep = "plan_qa";
    }
    const system = composeSystemPrompt(planStep, this.promptContext());
    const treeCtx = await this.folderTreeContext();
    const parts = [`源文件：**${name}**\n\n${treeCtx ? `${treeCtx}\n\n` : ""}分析：\n${analysis}\n\n原始内容：\n${content}`];
    if (feedback.trim()) parts.push(feedback);
    return this.runLLMStep(
      "plan",
      [
        { role: "system", content: system },
        { role: "user", content: parts.join("\n\n---\n\n") },
      ],
      0.2,
      4096,
      { promptStep: planStep, toolMode },
    );
  }

  private async generateFromPlan(
    name: string,
    content: string,
    analysis: string,
    planJson: string,
  ): Promise<ApplyWikiResult> {
    const prompt = `源文件：**${name}**

已批准计划（必须遵循 — 仅据此重新生成 FILE 块）：
${planJson}

分析（参考）：
${analysis}

原始内容：
${content}

请按 FILE 块格式生成 wiki 页面。`;
    const system = composeSystemPrompt("generation", this.promptContext());
    const result = await this.runLLMStep(
      "generation",
      [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
      0.1,
      32768,
      { promptStep: "generation" },
    );

    const parsed = parseFileBlocksWithContent(result);
    const normalized = normalizeWikiFileBlocks(parsed);
    if (normalized.adjustments.length > 0) {
      this.recorder?.record("apply_files", "warn", "normalized FILE paths", {
        adjustments: normalized.adjustments,
      });
    }
    assertBlocksMatchApprovedPlan(normalized.blocks, planJson);

    const actions = parsePlanActions(planJson);
    const movedSources = new Set<string>();
    if (actions.length > 0 && this.db) {
      for (const action of actions) {
        if (action.action !== "move" || !action.from_path || !action.to_path) continue;
        try {
          const fromRel = normalizeWikiFilePath(action.from_path);
          const toRel = normalizeWikiFilePath(action.to_path);
          if (fromRel === toRel) continue;
          const existing = await this.db.getDocumentByRelativePath(fromRel);
          const targetFolder = folderPathFromWikiRelPath(toRel);
          if (existing && targetFolder) {
            await this.db.moveDocument(existing.id, targetFolder, path.posix.basename(toRel), "review");
            movedSources.add(fromRel);
          }
        } catch (error) {
          this.recorder?.record("apply_files", "warn", `preserve-id move failed: ${errorMessage(error)}`, {
            from_path: action.from_path,
            to_path: action.to_path,
          });
        }
      }
    }
    if (actions.length > 0) {
      const remainingActions = actions.filter(
        (action) => !(action.action === "move" && action.from_path && movedSources.has(normalizeWikiFilePath(action.from_path))),
      );
      const deletePaths = sourcePathsToDelete(remainingActions, normalized.blocks);
      for (const rel of deletePaths) normalized.blocks.set(rel, "---DELETE---\n");
      if (deletePaths.length > 0) {
        this.recorder?.record(
          "apply_files",
          "info",
          "post-apply cleanup: injecting DELETE blocks for move/merge sources",
          { delete_paths: deletePaths },
        );
      }
    }

    return this.applyBlocksLocked(normalized.blocks);
  }

  /**
   * Reading the current page, merging into it and committing happen as one critical section:
   * a concurrent writer of the same page has to merge on top of this write, not on a stale copy.
   */
  private applyBlocksLocked(blocks: Map<string, string>): Promise<ApplyWikiResult> {
    return withPageLocks(this.lockMgr, [...blocks.keys()], () => this.applyBlocks(blocks));
  }

  private async applyBlocks(blocks: Map<string, string>): Promise<ApplyWikiResult> {
    if (!this.db) {
      throw new Error("database not configured");
    }
    const { result, changeSetId } = await applyBlocksToStore(this.effectiveWorkspace(), blocks, this.applyOptions(), {
      db: this.db,
      changeSetKind: this.changeSetKind,
      changeSetJobId: this.changeSetJobId,
      changeSetReviewId: this.changeSetReviewId,
      archiveFileId: this.archiveFileId,
      sourceFilename: this.sourceFilename,
      normalizedContent: this.normalizedContent,
      recorder: this.recorder,
    });
    if (changeSetId) this.lastChangeSetID = changeSetId;
    return result;
  }

  private async runLLMStep(
    step: string,
    messages: Message[],
    temperature: number,
    maxTokens: number,
    options: { promptStep?: PromptStep; toolMode?: string } = {},
  ): Promise<string> {
    if (!this.llmClient) throw new Error("LLM client not configured");
    const stopTrace = traceRetries(this.llmClient, this.recorder, step);
    try {
      return await this.runLLMStepTraced(step, messages, temperature, maxTokens, options);
    } finally {
      stopTrace();
    }
  }

  private async runLLMStepTraced(
    step: string,
    messages: Message[],
    temperature: number,
    maxTokens: number,
    options: { promptStep?: PromptStep; toolMode?: string } = {},
  ): Promise<string> {
    if (!this.llmClient) throw new Error("LLM client not configured");
    recordLLMRequest(this.recorder, step, this.llmClient.model, llmMessagesForRecord(messages), temperature, maxTokens);
    const started = Date.now();

    const promptStep = options.promptStep ?? promptStepForStepName(step);
    // Generation must emit FILE blocks as plain text. With tools enabled, MiniMax
    // often finishes on a tool-call-only message whose content is empty, which
    // used to surface as "applied 0 pages"; keep generation tool-free instead.
    const generationOnly = promptStep === "generation";
    const config = generationOnly
      ? { maxRounds: 0, maxToolCallsPerRound: 0 }
      : (this.toolLoopConfig ?? defaultToolLoopConfigForStep(promptStep));

    if (config.maxRounds > 0) {
      const executor = new PipelineToolExecutor(this.workspace, this.db, this.mcpExecutor, options.toolMode ?? "");
      try {
        const tools = await executor.listTools();
        if (tools.length > 0) {
          const result = await runToolLoop(this.llmClient, executor, messages, tools, temperature, maxTokens, config, {
            step,
            recorder: this.recorder,
          });
          recordLLMResponse(this.recorder, step, result, Date.now() - started);
          return this.ensureGenerationBlocks(step, result, messages, temperature, maxTokens);
        }
      } catch (error) {
        if (promptStep === "analysis") {
          this.recorder?.record(step, "error", "analysis tool loop failed; refusing blind fallback", {
            error: errorMessage(error),
            max_rounds: config.maxRounds,
          });
          throw new Error(`analysis tool loop failed; refusing blind generation: ${errorMessage(error)}`);
        }
        this.recorder?.record(step, "warn", "tool loop failed, falling back to stream", {
          error: errorMessage(error),
          max_rounds: config.maxRounds,
        });
      }
    }

    if (!generationOnly && this.mcpExecutor && !this.mcpExecutor.isLocalOnly()) {
      const mcpConfig = this.toolLoopConfig ?? defaultToolLoopConfig();
      try {
        const tools = await this.mcpExecutor.listTools();
        if (tools.length > 0) {
          const result = await runToolLoop(this.llmClient, this.mcpExecutor, messages, tools, temperature, maxTokens, mcpConfig, {
            step,
            recorder: this.recorder,
          });
          recordLLMResponse(this.recorder, step, result, Date.now() - started);
          return this.ensureGenerationBlocks(step, result, messages, temperature, maxTokens);
        }
      } catch (error) {
        this.recorder?.record(step, "warn", "tool loop failed, falling back to stream", {
          error: errorMessage(error),
          max_rounds: mcpConfig.maxRounds,
        });
      }
    }

    const chunks: string[] = [];
    for await (const event of this.llmClient.streamChat(messages, temperature, maxTokens)) {
      if (event.type === "token") chunks.push(event.content ?? "");
      if (event.type === "error" && event.error) {
        this.recorder?.record(step, "error", event.error.message, null);
        throw event.error;
      }
    }
    const result = chunks.join("");
    recordLLMResponse(this.recorder, step, result, Date.now() - started);
    return this.ensureGenerationBlocks(step, result, messages, temperature, maxTokens);
  }

  private async ensureGenerationBlocks(
    step: string,
    result: string,
    messages: Message[],
    temperature: number,
    maxTokens: number,
  ): Promise<string> {
    if (promptStepForStepName(step) !== "generation") return result;
    if (parseFileBlocks(result).length > 0) return result;
    if (!this.llmClient) throw new Error("LLM client not configured");
    this.recorder?.record(step, "warn", "generation returned no FILE blocks; retrying with strict format", {
      char_count: result.length,
    });
    const strict: Message[] = [
      ...messages,
      {
        role: "user",
        content:
          "上一条回复没有可用的 FILE 块。现在只输出 wiki 文件，严格使用如下格式：\n" +
          "---FILE: wiki/<目录>/<页面>.md\n（markdown 正文）\n---END FILE---\n" +
          "路径必须以 wiki/ 开头，至少一个 FILE 块；不要输出分析、解释或任何额外文字。",
      },
    ];
    const chunks: string[] = [];
    for await (const event of this.llmClient.streamChat(strict, temperature, maxTokens)) {
      if (event.type === "token") chunks.push(event.content ?? "");
      if (event.type === "error" && event.error) throw event.error;
    }
    const retry = chunks.join("");
    recordLLMResponse(this.recorder, step, retry, 0);
    if (parseFileBlocks(retry).length === 0) throw new NoWikiFilesWrittenError();
    return retry;
  }
}

export function promptStepForStepName(step: string): PromptStep {
  if (step === "analysis") return "analysis";
  if (step === "generation") return "generation";
  if (step === "plan") return "plan";
  return "" as PromptStep;
}

export function defaultToolLoopConfigForStep(step: PromptStep): ToolLoopConfig {
  switch (step) {
    case "analysis":
      return { maxRounds: 4, maxToolCallsPerRound: 4 };
    case "plan":
      return { maxRounds: 5, maxToolCallsPerRound: 4 };
    case "plan_organize":
      return { maxRounds: 8, maxToolCallsPerRound: 4 };
    case "plan_qa":
      return { maxRounds: 5, maxToolCallsPerRound: 4 };
    case "generation":
      return { maxRounds: 4, maxToolCallsPerRound: 4 };
    default:
      return { maxRounds: 0, maxToolCallsPerRound: 0 };
  }
}

export { formatFeedbackForPlan, EMPTY_MERGE };
export type { WikiRefInput };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
