import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../server/app.js";
import type { ChangeSetListFilter, ChangeSetListResult } from "../store/history_list.js";
import type { Store } from "../store/interfaces.js";

const EMPTY: ChangeSetListResult = {
  changes: [],
  total: 0,
  limit: 50,
  offset: 0,
  has_more: false,
  counts: { ingest: 1, review_apply: 2, rollback: 0, manual: 3, delete: 0, import: 0 },
};

function makeApp(listChangeSets: (filter: ChangeSetListFilter) => Promise<ChangeSetListResult>) {
  return createApp({
    db: { listChangeSets } as unknown as Store,
    token: "",
    publicWiki: true,
    noMcp: true,
    mcpAllowWrite: false,
    workspace: "",
    webRoot: "/tmp/nonexistent-web",
    skillsRoot: path.resolve(process.cwd(), "skills"),
  });
}

describe("GET /api/v1/history", () => {
  it("returns the paged envelope and passes normalized filters to the store", async () => {
    const listChangeSets = vi.fn(async () => EMPTY);
    const app = makeApp(listChangeSets);

    const res = await app.request(
      "/api/v1/history?kind=ingest,manual&from=2026-11-28T00:00:00%2B08:00&to=2026-11-28&q=notes&limit=0&offset=-4",
    );
    const body = (await res.json()) as ChangeSetListResult;

    expect(res.status).toBe(200);
    expect(body).toEqual(EMPTY);
    expect(listChangeSets).toHaveBeenCalledWith({
      kinds: ["ingest", "manual"],
      query: "notes",
      from: "2026-11-27 16:00:00",
      to: "2026-11-28 23:59:59",
      before: "",
      limit: 1,
      offset: 0,
    });
  });

  it("caps limit at 200 and supports before", async () => {
    const listChangeSets = vi.fn(async () => EMPTY);
    const app = makeApp(listChangeSets);

    const res = await app.request("/api/v1/history?limit=999&before=2026-11-28T10:00:00Z");

    expect(res.status).toBe(200);
    expect(listChangeSets).toHaveBeenCalledWith({
      kinds: [],
      query: "",
      from: "",
      to: "",
      before: "2026-11-28 10:00:00",
      limit: 200,
      offset: 0,
    });
  });

  it("rejects unknown kind, invalid timestamps, and inverted ranges before querying", async () => {
    const listChangeSets = vi.fn(async () => EMPTY);
    const app = makeApp(listChangeSets);

    const badKind = await app.request("/api/v1/history?kind=nope");
    expect(badKind.status).toBe(400);
    expect(((await badKind.json()) as { error: string }).error).toContain("invalid kind");

    const badTime = await app.request("/api/v1/history?from=2026-02-30");
    expect(badTime.status).toBe(400);
    expect(((await badTime.json()) as { error: string }).error).toContain("invalid from timestamp");

    const inverted = await app.request("/api/v1/history?from=2026-11-28&to=2026-11-27");
    expect(inverted.status).toBe(400);
    expect(((await inverted.json()) as { error: string }).error).toContain("from must not be after to");

    expect(listChangeSets).not.toHaveBeenCalled();
  });
});
