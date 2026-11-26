import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../server/app.js";
import type { IngestJobListFilter, IngestJobListResult } from "../store/job_list.js";
import type { Store } from "../store/interfaces.js";

const EMPTY: IngestJobListResult = {
  jobs: [],
  total: 0,
  counts: { queued: 1, running: 2, succeeded: 3, failed: 4, cancelled: 5 },
};

function makeApp(listIngestJobs: (filter: IngestJobListFilter) => Promise<IngestJobListResult>) {
  return createApp({
    db: { listIngestJobs } as unknown as Store,
    token: "",
    publicWiki: true,
    noMcp: true,
    mcpAllowWrite: false,
    workspace: "",
    webRoot: "/tmp/nonexistent-web",
    skillsRoot: path.resolve(process.cwd(), "skills"),
  });
}

describe("GET /api/v1/ingest/jobs", () => {
  it("returns the page envelope and passes clamped filters to the store", async () => {
    const listIngestJobs = vi.fn(async () => EMPTY);
    const app = makeApp(listIngestJobs);

    const res = await app.request(
      "/api/v1/ingest/jobs?status=queued,running&input_type=text&q=notes&limit=0&offset=-4",
    );
    const body = (await res.json()) as IngestJobListResult;

    expect(res.status).toBe(200);
    expect(body.jobs).toEqual([]);
    expect(body.total).toBe(0);
    expect(body.counts).toEqual(EMPTY.counts);
    expect(listIngestJobs).toHaveBeenCalledWith({
      statuses: ["queued", "running"],
      inputType: "text",
      query: "notes",
      limit: 1,
      offset: 0,
    });
  });

  it("caps limit at 100", async () => {
    const listIngestJobs = vi.fn(async () => EMPTY);
    const app = makeApp(listIngestJobs);

    const res = await app.request("/api/v1/ingest/jobs?limit=999");

    expect(res.status).toBe(200);
    expect(listIngestJobs).toHaveBeenCalledWith({
      statuses: [],
      inputType: "",
      query: "",
      limit: 100,
      offset: 0,
    });
  });

  it("rejects an unknown status before querying", async () => {
    const listIngestJobs = vi.fn(async () => EMPTY);
    const app = makeApp(listIngestJobs);

    const res = await app.request("/api/v1/ingest/jobs?status=nope");
    const body = (await res.json()) as { error: string };

    expect(res.status).toBe(400);
    expect(body.error).toContain("invalid status");
    expect(listIngestJobs).not.toHaveBeenCalled();
  });
});
