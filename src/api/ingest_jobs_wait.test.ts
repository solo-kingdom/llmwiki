import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../server/app.js";
import type { Store } from "../store/interfaces.js";
import type { ArchiveFile, IngestJob } from "../store/types.js";
import { parseWaitMs } from "./ingest_jobs.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("parseWaitMs", () => {
  it("parses seconds, milliseconds, minutes, and bare numbers", () => {
    expect(parseWaitMs(undefined)).toBe(0);
    expect(parseWaitMs("")).toBe(0);
    expect(parseWaitMs("0")).toBe(0);
    expect(parseWaitMs("-5s")).toBe(0);
    expect(parseWaitMs("abc")).toBe(0);
    expect(parseWaitMs("30s")).toBe(30_000);
    expect(parseWaitMs("15")).toBe(15_000);
    expect(parseWaitMs("500ms")).toBe(500);
    expect(parseWaitMs("1m")).toBe(55_000);
    expect(parseWaitMs("120s")).toBe(55_000);
  });
});

function makeTextIngestApp(getIngestJob: (id: string) => Promise<IngestJob | null>) {
  const workspace = mkdtempSync(path.join(os.tmpdir(), "llmwiki-wait-test-"));
  tempDirs.push(workspace);

  const db = {
    getConfig: vi.fn(async () => ""),
    getAllConfig: vi.fn(async () => ({})),
    createArchiveFolder: vi.fn(async () => undefined),
    ensureArchiveFolderPath: vi.fn(async () => ({ id: "folder-1", path: "experience" })),
    getArchiveFileByRelativePath: vi.fn(async () => null),
    findArchiveFileBySha256: vi.fn(async () => null),
    createArchiveFile: vi.fn(async (file: ArchiveFile) => ({
      ...file,
      id: "af-1",
    })),
    createIngestJob: vi.fn(async (job: IngestJob) => {
      job.id = "job-1";
      job.created_at = "2026-11-27T00:00:00Z";
      job.updated_at = "2026-11-27T00:00:00Z";
    }),
    setArchiveFileIngestJobId: vi.fn(async () => undefined),
    getIngestJob,
    listRuleFiles: vi.fn(async () => []),
    insertIngestJobEvent: vi.fn(async () => undefined),
    createActivity: vi.fn(async () => undefined),
    insertActivity: vi.fn(async () => undefined),
  } as unknown as Store;

  return createApp({
    db,
    token: "",
    publicWiki: true,
    noMcp: true,
    mcpAllowWrite: false,
    workspace,
    webRoot: "/tmp/nonexistent-web",
    skillsRoot: path.resolve(process.cwd(), "skills"),
  });
}

describe("POST /api/v1/ingest/jobs/text ?wait=", () => {
  it("returns immediately without wait query param", async () => {
    const getIngestJob = vi.fn(async () => null);
    const app = makeTextIngestApp(getIngestJob);

    const res = await app.request("/api/v1/ingest/jobs/text", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "# Note\nhello", title: "Note", archive_folder: "experience" }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { job: IngestJob; waited?: boolean };
    expect(body.job.id).toBe("job-1");
    expect(body.job.status).toBe("queued");
    expect(body.waited).toBeUndefined();
    expect(getIngestJob).not.toHaveBeenCalled();
  });

  it("waits until job reaches succeeded when ?wait= is provided", async () => {
    let calls = 0;
    const getIngestJob = vi.fn(async (id: string): Promise<IngestJob | null> => {
      calls += 1;
      return {
        id,
        parent_job_id: "",
        input_type: "text",
        source_path: "experience/note.md",
        source_ref: "test",
        archive_file_id: "af-1",
        status: calls >= 2 ? "succeeded" : "running",
        retries: 0,
        max_retries: 3,
        error: "",
        error_code: "",
        error_message: "",
        missing_dependency: "",
        remediation: "",
        result_summary: calls >= 2 ? "1 page updated" : "",
        created_at: "2026-11-27T00:00:00Z",
        updated_at: "2026-11-27T00:00:01Z",
      };
    });
    const app = makeTextIngestApp(getIngestJob);

    const res = await app.request("/api/v1/ingest/jobs/text?wait=2s", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "# Note\nhello", title: "Note", archive_folder: "experience" }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { job: IngestJob; waited: boolean; timed_out: boolean };
    expect(body.job.status).toBe("succeeded");
    expect(body.waited).toBe(true);
    expect(body.timed_out).toBe(false);
    expect(getIngestJob).toHaveBeenCalledTimes(2);
  });

  it("returns timed_out=true when job stays running past wait window", async () => {
    const getIngestJob = vi.fn(async (id: string): Promise<IngestJob | null> => ({
      id,
      parent_job_id: "",
      input_type: "text",
      source_path: "experience/note.md",
      source_ref: "test",
      archive_file_id: "af-1",
      status: "running",
      retries: 0,
      max_retries: 3,
      error: "",
      error_code: "",
      error_message: "",
      missing_dependency: "",
      remediation: "",
      result_summary: "",
      created_at: "2026-11-27T00:00:00Z",
      updated_at: "2026-11-27T00:00:00Z",
    }));
    const app = makeTextIngestApp(getIngestJob);

    const res = await app.request("/api/v1/ingest/jobs/text?wait=120ms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "# Note\nhello", title: "Note", archive_folder: "experience" }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { job: IngestJob; waited: boolean; timed_out: boolean };
    expect(body.job.status).toBe("running");
    expect(body.waited).toBe(true);
    expect(body.timed_out).toBe(true);
  });
});
