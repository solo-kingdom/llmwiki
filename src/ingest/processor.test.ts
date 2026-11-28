import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Store } from "../store/interfaces.js";
import type { IngestJob, NormalizedSource, ProviderInstance } from "../store/types.js";
import { PageLockManager } from "./lock.js";
import { Pipeline } from "./pipeline.js";
import { JobProcessor, classifyPipelineError, remediationForCode } from "./processor.js";
import { PagePlanReviewRequiredError } from "./page_plan.js";

const POLL_MS = 5;

const workspaces: string[] = [];
const processors: JobProcessor[] = [];

afterEach(async () => {
  for (const processor of processors.splice(0)) processor.stop();
  await Promise.all(workspaces.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("timed out waiting for the processor");
    await sleep(POLL_MS);
  }
}

async function tempWorkspace(count: number): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "llmwiki-processor-"));
  workspaces.push(dir);
  for (let index = 1; index <= count; index += 1) {
    await writeFile(path.join(dir, `job-${String(index).padStart(2, "0")}.md`), "source", "utf8");
  }
  return dir;
}

interface StoreOptions {
  parallel: boolean;
  maxConcurrent: number;
  count: number;
  /** Jobs whose failure cannot be recorded, as when the database is unreachable. */
  crashOnFailure?: string[];
}

/** Mirrors the PostgreSQL store's claim rule: at most `limit` running jobs, oldest first. */
function fakeStore(options: StoreOptions) {
  const jobs: IngestJob[] = Array.from({ length: options.count }, (_, index) => {
    const id = `job-${String(index + 1).padStart(2, "0")}`;
    return {
      id,
      parent_job_id: "",
      input_type: "file",
      source_path: `${id}.md`,
      source_ref: "",
      status: "queued",
      retries: 0,
      max_retries: 3,
      error: "",
      error_code: "",
      error_message: "",
      missing_dependency: "",
      remediation: "",
      result_summary: "",
      runner_id: "",
      heartbeat_at: "",
      archive_file_id: "",
      created_at: `2026-01-01 00:00:${String(index).padStart(2, "0")}`,
      updated_at: "",
    };
  });
  const settings = { parallel: options.parallel, maxConcurrent: options.maxConcurrent };
  const instance: ProviderInstance = {
    id: "inst-test",
    name: "test",
    catalog_id: "openai",
    api_format: "openai",
    api_key: "test-key",
    base_url: "http://127.0.0.1:9/v1",
    models: ["test-model"],
    created_at: "",
    updated_at: "",
  };
  const find = (id: string) => jobs.find((job) => job.id === id);
  const store = {
    jobs,
    settings,
    parallelEnabled: async () => settings.parallel,
    maxConcurrentJobs: async () => settings.maxConcurrent,
    recoverStaleRunningJobs: async () => [],
    claimNextIngestJob: async (runner: string) => {
      const limit = settings.parallel ? settings.maxConcurrent : 1;
      if (jobs.filter((job) => job.status === "running").length >= limit) return null;
      const next = jobs.find((job) => job.status === "queued");
      if (!next) return null;
      Object.assign(next, { status: "running", runner_id: runner, heartbeat_at: "now" });
      return { ...next };
    },
    touchIngestJobHeartbeat: async () => undefined,
    clearIngestJobLease: async (id: string) => {
      Object.assign(find(id) ?? {}, { runner_id: "", heartbeat_at: "" });
    },
    markIngestJobSucceeded: async (id: string, summary: string) => {
      Object.assign(find(id) ?? {}, { status: "succeeded", result_summary: summary });
    },
    updateIngestJobFailure: async (id: string, errorCode: string, message: string) => {
      if (options.crashOnFailure?.includes(id)) throw new Error("database is unreachable");
      Object.assign(find(id) ?? {}, { status: "failed", error_code: errorCode, error_message: message });
    },
    getIngestJob: async (id: string) => {
      const job = find(id);
      return job ? { ...job } : null;
    },
    getJobEventsMaxCount: async () => 200,
    insertIngestJobEvent: async () => undefined,
    listIngestJobEvents: async () => [],
    getConfig: async (key: string) =>
      ({ job_instance_id: "inst-test", job_model: "test-model" } as Record<string, string>)[key] ?? "",
    getProviderInstance: async () => instance,
    getProviderInfo: async () => null,
    createActivityLog: async () => undefined,
    countActivityLogs: async () => 0,
  };
  return { store: store as unknown as Store, jobs, settings };
}

interface Script {
  durationMs?: number;
  fail?: boolean;
  gate?: Promise<void>;
}

/** A real Pipeline whose only model call is replaced by a timed, scriptable wait. */
class FakePipeline extends Pipeline {
  static scripts: Record<string, Script> = {};
  static readonly started: string[] = [];
  static readonly finished: string[] = [];
  static readonly lockManagers = new Set<PageLockManager>();
  static active = 0;
  static peak = 0;
  private jobId = "";

  constructor(workspace: string, db: Store | null, lockManager: PageLockManager) {
    super(workspace, db, null, lockManager);
    FakePipeline.lockManagers.add(this.lockManager());
  }

  static reset(scripts: Record<string, Script>): void {
    FakePipeline.scripts = scripts;
    FakePipeline.started.length = 0;
    FakePipeline.finished.length = 0;
    FakePipeline.lockManagers.clear();
    FakePipeline.active = 0;
    FakePipeline.peak = 0;
  }

  override setChangeSetMeta(kind: string, jobId: string): void {
    this.jobId = jobId;
    super.setChangeSetMeta(kind, jobId, "", "", "");
  }

  override async ingestNormalized(_source: NormalizedSource): Promise<string[]> {
    const script = FakePipeline.scripts[this.jobId] ?? {};
    FakePipeline.started.push(this.jobId);
    FakePipeline.active += 1;
    FakePipeline.peak = Math.max(FakePipeline.peak, FakePipeline.active);
    try {
      if (script.gate) await script.gate;
      else await sleep(script.durationMs ?? 15);
      if (script.fail) throw new Error("generation: model exploded");
      return [`wiki/pages/${this.jobId}.md`];
    } finally {
      FakePipeline.active -= 1;
      FakePipeline.finished.push(this.jobId);
    }
  }
}

async function startProcessor(
  options: StoreOptions,
  scripts: Record<string, Script>,
  lockManager = new PageLockManager(),
) {
  const fake = fakeStore(options);
  FakePipeline.reset(scripts);
  const workspace = await tempWorkspace(options.count);
  const processor = new JobProcessor(fake.store, workspace, {
    lockManager,
    createPipeline: (manager) => new FakePipeline(workspace, fake.store, manager),
  });
  processors.push(processor);
  processor.start(POLL_MS);
  return { ...fake, processor };
}

describe("JobProcessor scheduling", () => {
  it("runs one job at a time, oldest first, while parallel processing is off", async () => {
    const { jobs, processor } = await startProcessor(
      { parallel: false, maxConcurrent: 4, count: 5 },
      { "job-01": { durationMs: 30 }, "job-02": { durationMs: 5 } },
    );

    await processor.idle();

    expect(FakePipeline.peak).toBe(1);
    expect(FakePipeline.started).toEqual(["job-01", "job-02", "job-03", "job-04", "job-05"]);
    expect(FakePipeline.finished).toEqual(FakePipeline.started);
    expect(jobs.map((job) => job.status)).toEqual(jobs.map(() => "succeeded"));
  });

  it("fills up to job_max_concurrent while parallel processing is on", async () => {
    const shared = new PageLockManager();
    const { jobs, processor } = await startProcessor({ parallel: true, maxConcurrent: 3, count: 8 }, {
      "job-01": { durationMs: 40 },
      "job-02": { durationMs: 40 },
      "job-03": { durationMs: 40 },
    }, shared);

    await processor.idle();

    expect(FakePipeline.peak).toBe(3);
    expect(FakePipeline.finished[0]).toBe("job-01");
    expect(jobs.every((job) => job.status === "succeeded")).toBe(true);
    expect(jobs.every((job) => job.runner_id === "")).toBe(true);
  });

  it("gives every job its own pipeline on the shared lock manager", async () => {
    const shared = new PageLockManager();
    const { processor } = await startProcessor({ parallel: true, maxConcurrent: 4, count: 6 }, {}, shared);

    await processor.idle();

    expect([...FakePipeline.lockManagers]).toEqual([shared]);
  });

  it("never exceeds the number of queued jobs", async () => {
    const { processor } = await startProcessor({ parallel: true, maxConcurrent: 6, count: 3 }, {
      "job-01": { durationMs: 30 },
      "job-02": { durationMs: 30 },
      "job-03": { durationMs: 30 },
    });

    await processor.idle();

    expect(FakePipeline.peak).toBe(3);
  });

  it("records a failed job and keeps the other slots working", async () => {
    const { jobs, processor } = await startProcessor({ parallel: true, maxConcurrent: 2, count: 5 }, {
      "job-02": { durationMs: 20, fail: true },
      "job-03": { durationMs: 20 },
    });

    await processor.idle();

    expect(jobs.find((job) => job.id === "job-02")).toMatchObject({
      status: "failed",
      error_code: "generation_failed",
    });
    expect(jobs.filter((job) => job.id !== "job-02").map((job) => job.status)).toEqual([
      "succeeded",
      "succeeded",
      "succeeded",
      "succeeded",
    ]);
  });

  it("keeps claiming when even the failure cannot be recorded", async () => {
    const { jobs, processor } = await startProcessor(
      { parallel: true, maxConcurrent: 2, count: 4, crashOnFailure: ["job-01"] },
      { "job-01": { durationMs: 10, fail: true } },
    );

    await processor.idle();

    expect(jobs.filter((job) => job.id !== "job-01").map((job) => job.status)).toEqual([
      "succeeded",
      "succeeded",
      "succeeded",
    ]);
  });

  it("applies a higher concurrency while jobs are already running", async () => {
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { settings, processor } = await startProcessor({ parallel: true, maxConcurrent: 1, count: 6 }, {
      "job-01": { gate },
      "job-02": { gate },
      "job-03": { gate },
    });
    await waitFor(() => FakePipeline.active === 1);

    settings.maxConcurrent = 3;
    await waitFor(() => FakePipeline.active === 3);
    release?.();

    await processor.idle();
    expect(FakePipeline.peak).toBe(3);
  });
});


describe("pipeline structure failures", () => {
  it("routes excessive page creation to review and invalid plans to analysis correction", () => {
    expect(classifyPipelineError(new PagePlanReviewRequiredError("too many pages"))).toBe("review_required");
    expect(remediationForCode("review_required")).toContain("review");
    expect(classifyPipelineError(new Error("analysis is empty; refusing generation and apply"))).toBe("invalid_page_plan");
    expect(remediationForCode("invalid_page_plan")).toContain("not attempted");
    expect(
      classifyPipelineError(
        new Error("analysis tool loop failed; refusing blind generation: tool loop exceeded max rounds (16)"),
      ),
    ).toBe("analysis_failed");
  });
});
