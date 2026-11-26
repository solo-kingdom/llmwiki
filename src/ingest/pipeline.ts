import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Client } from "../llm/client.js";
import { defaultToolLoopConfig, runToolLoop } from "../llm/tools.js";
import type { Message, ToolLoopConfig } from "../llm/types.js";
import type { McpRouter } from "../mcp/router.js";
import type { Store } from "../store/interfaces.js";
import { folderPathFromWikiRelPath } from "../engine/wiki_org.js";
import { formatFolderTreeForPrompt } from "../mcp/diagnostic_tools.js";
import { IngestCache } from "./cache.js";
import { applyBlocksToStore } from "./dbapply.js";
import { applyWikiBlocks, NoWikiFilesWrittenError, normalizeWikiFileBlocks, normalizeWikiFilePath, parseFileBlocks, parseFileBlocksWithContent } from "./fileblocks.js";
import { llmMessagesForRecord, recordLLMRequest, recordLLMResponse } from "./job_events.js";
import { PageLockManager } from "./lock.js";
import { normalizeUpload } from "./normalize.js";
import { composeSystemPrompt } from "./prompts.js";
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
  private lockMgr = new PageLockManager();
  private recorder: JobRecorder | null = null;
  private mcpExecutor: PipelineMcpExecutor | null = null;
  private toolLoopConfig: ToolLoopConfig | null = null;
  private docLang = "zh";
  private rulesSupplement = "";
  private forceOverwrite = false;
  private applyToDB: boolean;
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
  ) {
    this.db = db;
    this.llmClient = llmClient;
    this.applyToDB = db !== null;
    this.cache = new IngestCache(workspace);
  }

  setDb(db: Store | null): void {
    this.db = db;
    this.applyToDB = db !== null;
  }

  setApplyToDB(value: boolean): void {
    this.applyToDB = value;
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

    const cached = await this.cache.lookupForSource(source, legacyKeys);
    if (cached) {
      this.recorder?.record("cache", "hit", "cache hit", {
        canonical_path: source.canonicalPath,
        paths_written: cached.written_files,
      });
      return cached.written_files;
    }

    const analysis = await this.analyze(name, content);
    const files = await this.generate(name, content, analysis);
    this.recorder?.record("apply_files", "complete", "wiki files applied", { paths_written: files });
    await this.cache.saveForSource(source, files);
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

    const analysis = await this.analyze(name, content);
    const result = await this.generateFromPlan(name, content, analysis, plan);
    this.recorder?.record("apply_files", "complete", "wiki files applied from approved plan", {
      paths_written: result.written,
      paths_deleted: result.deleted,
    });
    return result;
  }

  private async folderTreeContext(): Promise<string> {
    if (!this.db) return "";
    try {
      const [folders, docs] = await Promise.all([
        typeof this.db.listFolders === "function" ? this.db.listFolders(true) : Promise.resolve([]),
        this.db.listDocumentsFiltered({ source_kind: "wiki", exclude_hidden: true }),
      ]);
      const summary = formatFolderTreeForPrompt(folders, docs);
      return summary ? `当前目录树（请优先复用已有匹配目录）：\n${summary}` : "";
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
      4096,
      { promptStep: "analysis" },
    );
  }

  private async generate(name: string, content: string, analysis: string): Promise<string[]> {
    const treeCtx = await this.folderTreeContext();
    const prompt = `源文件：**${name}**

${treeCtx ? `${treeCtx}\n\n` : ""}分析（仅供参考）：
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
      8192,
      { promptStep: "generation" },
    );

    const parsed = parseFileBlocksWithContent(result);
    const normalized = normalizeWikiFileBlocks(parsed);
    if (normalized.adjustments.length > 0) {
      this.recorder?.record("apply_files", "warn", "normalized FILE paths", {
        adjustments: normalized.adjustments,
      });
    }
    for (const rel of normalized.blocks.keys()) {
      const unlock = await this.lockMgr.lock(rel);
      unlock();
    }
    const applied = await this.applyBlocks(normalized.blocks);
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
      8192,
      { promptStep: "generation" },
    );

    const parsed = parseFileBlocksWithContent(result);
    const normalized = normalizeWikiFileBlocks(parsed);
    if (normalized.adjustments.length > 0) {
      this.recorder?.record("apply_files", "warn", "normalized FILE paths", {
        adjustments: normalized.adjustments,
      });
    }

    const actions = parsePlanActions(planJson);
    const movedSources = new Set<string>();
    if (actions.length > 0 && this.applyToDB && this.db) {
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

    for (const rel of normalized.blocks.keys()) {
      const unlock = await this.lockMgr.lock(rel);
      unlock();
    }
    return this.applyBlocks(normalized.blocks);
  }

  private async applyBlocks(blocks: Map<string, string>): Promise<ApplyWikiResult> {
    if (!this.applyToDB || !this.db) {
      return applyWikiBlocks(this.effectiveWorkspace(), blocks, this.applyOptions());
    }
    const { result, changeSetId } = await applyBlocksToStore(this.effectiveWorkspace(), blocks, this.applyOptions(), {
      applyToDB: this.applyToDB,
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
          const result = await runToolLoop(this.llmClient, executor, messages, tools, temperature, maxTokens, config);
          recordLLMResponse(this.recorder, step, result, Date.now() - started);
          return this.ensureGenerationBlocks(step, result, messages, temperature, maxTokens);
        }
      } catch (error) {
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
          const result = await runToolLoop(this.llmClient, this.mcpExecutor, messages, tools, temperature, maxTokens, mcpConfig);
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
