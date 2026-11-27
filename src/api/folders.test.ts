import { describe, expect, it, vi } from "vitest";
import { createApp } from "../server/app.js";
import {
  FolderConflictError,
  FolderNotFoundError,
  FolderValidationError,
} from "../store/postgres/folders.js";
import type { Store } from "../store/interfaces.js";

function makeMockStore(overrides: Partial<Store> = {}): Store {
  return {
    getConfig: vi.fn().mockResolvedValue(""),
    countActivityLogs: vi.fn().mockResolvedValue(0),
    createActivityLog: vi.fn().mockResolvedValue(undefined),
    listFolders: vi.fn().mockResolvedValue([
      {
        path: "AI工程",
        display_name: "AI 工程",
        description: "AI 工程实践",
        sort_order: 1,
        created_at: "2026-11-24",
        updated_at: "2026-11-24",
        direct_count: 1,
        total_count: 1,
      },
    ]),
    listDocumentsFiltered: vi.fn().mockResolvedValue([
      {
        id: "doc-1",
        filename: "harness.md",
        title: "Harness",
        path: "/wiki/AI工程/",
        relative_path: "wiki/AI工程/harness.md",
        source_kind: "wiki",
        page_type: "concept",
        file_type: "md",
        page_count: 0,
        updated_at: "2026-11-24",
      },
    ]),
    listDocuments: vi.fn().mockResolvedValue([]),
    listReferenceEntries: vi.fn().mockResolvedValue([]),
    createFolder: vi.fn().mockResolvedValue({
      path: "AI工程/Agent",
      display_name: "Agent",
      description: "",
      sort_order: 0,
      created_at: "2026-11-24",
      updated_at: "2026-11-24",
    }),
    updateFolder: vi.fn().mockResolvedValue({
      path: "AI工程",
      display_name: "AI Engineering",
      description: "updated",
      sort_order: 2,
      created_at: "2026-11-24",
      updated_at: "2026-11-24",
    }),
    moveFolder: vi.fn().mockResolvedValue({
      from_path: "AI工程/Agent",
      to_path: "工程/Agent",
      moved_folders: 1,
      moved_documents: 1,
      moved_doc_paths: ["wiki/工程/Agent/harness.md"],
      change_set_id: "cs-1",
      updated_link_paths: [],
    }),
    deleteFolder: vi.fn().mockResolvedValue({
      path: "AI工程/Agent",
      mode: "empty",
      deleted_folders: 1,
      moved_documents: 0,
      deleted_documents: 0,
      change_set_id: "",
    }),
    moveDocument: vi.fn().mockResolvedValue({
      document: {
        id: "doc-1",
        filename: "harness.md",
        title: "Harness",
        path: "/wiki/工程/",
        relative_path: "wiki/工程/harness.md",
        source_kind: "wiki",
        page_type: "concept",
      },
      old_relative_path: "wiki/AI工程/harness.md",
      change_set_id: "cs-2",
      updated_link_paths: [],
    }),
    ...overrides,
  } as unknown as Store;
}

function makeApp(store: Store) {
  return createApp({
    db: store,
    token: "",
    publicWiki: true,
    noMcp: true,
    mcpAllowWrite: false,
    workspace: "/tmp/nonexistent-llmwiki-ws",
    webRoot: "/tmp/nonexistent-web",
    skillsRoot: "/tmp/nonexistent-skills",
  });
}

describe("folders and tree API", () => {
  it("GET /api/v1/tree returns folders and documents", async () => {
    const app = makeApp(makeMockStore());
    const res = await app.request("/api/v1/tree");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { folders: unknown[]; documents: unknown[] };
    expect(body.folders).toHaveLength(1);
    expect(body.documents).toHaveLength(1);
  });

  it("GET /api/public/wiki/tree returns public tree", async () => {
    const app = makeApp(makeMockStore());
    const res = await app.request("/api/public/wiki/tree");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { folders: unknown[]; documents: unknown[] };
    expect(body.folders).toHaveLength(1);
    expect(body.documents).toHaveLength(1);
  });

  it("POST /api/v1/folders creates folder and maps conflict/validation errors", async () => {
    const okApp = makeApp(makeMockStore());
    const res1 = await okApp.request("/api/v1/folders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "AI工程/Agent", display_name: "Agent" }),
    });
    expect(res1.status).toBe(201);

    const conflictApp = makeApp(
      makeMockStore({
        createFolder: vi.fn().mockRejectedValue(new FolderConflictError("already exists")),
      }),
    );
    const res2 = await conflictApp.request("/api/v1/folders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "AI工程" }),
    });
    expect(res2.status).toBe(409);

    const invalidApp = makeApp(
      makeMockStore({
        createFolder: vi.fn().mockRejectedValue(new FolderValidationError("bad path")),
      }),
    );
    const res3 = await invalidApp.request("/api/v1/folders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "../bad" }),
    });
    expect(res3.status).toBe(400);
  });

  it("PATCH /api/v1/folders updates metadata and returns 404 when missing", async () => {
    const app = makeApp(makeMockStore());
    const res = await app.request("/api/v1/folders", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "AI工程", display_name: "AI Engineering" }),
    });
    expect(res.status).toBe(200);

    const missingApp = makeApp(makeMockStore({ updateFolder: vi.fn().mockResolvedValue(null) }));
    const res404 = await missingApp.request("/api/v1/folders", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "missing", display_name: "X" }),
    });
    expect(res404.status).toBe(404);
  });

  it("POST /api/v1/folders/move and DELETE /api/v1/folders handle validation and success", async () => {
    const app = makeApp(makeMockStore());
    const moveRes = await app.request("/api/v1/folders/move", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from_path: "AI工程/Agent", to_path: "工程/Agent" }),
    });
    expect(moveRes.status).toBe(200);

    const badDelRes = await app.request("/api/v1/folders?path=AI工程&mode=invalid", {
      method: "DELETE",
    });
    expect(badDelRes.status).toBe(400);

    const delRes = await app.request("/api/v1/folders?path=AI工程/Agent&mode=empty", {
      method: "DELETE",
    });
    expect(delRes.status).toBe(200);
  });

  it("POST /api/v1/documents/:id/move moves document and maps 404", async () => {
    const app = makeApp(makeMockStore());
    const res = await app.request("/api/v1/documents/doc-1/move", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target_folder: "工程" }),
    });
    expect(res.status).toBe(200);

    const missingApp = makeApp(
      makeMockStore({
        moveDocument: vi.fn().mockRejectedValue(new FolderNotFoundError("not found")),
      }),
    );
    const res404 = await missingApp.request("/api/v1/documents/doc-404/move", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target_folder: "工程" }),
    });
    expect(res404.status).toBe(404);
  });

  it("POST /api/v1/documents/:id/move accepts an empty target_folder for the wiki root", async () => {
    const moveDocument = vi.fn().mockResolvedValue({
      document: { id: "doc-1", relative_path: "wiki/harness.md" },
      old_relative_path: "wiki/AI工程/harness.md",
      change_set_id: "cs-3",
      updated_link_paths: [],
    });
    const app = makeApp(makeMockStore({ moveDocument }));
    const res = await app.request("/api/v1/documents/doc-1/move", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target_folder: "", filename: "harness.md" }),
    });
    expect(res.status).toBe(200);
    expect(moveDocument).toHaveBeenCalledWith("doc-1", "", "harness.md", "api");
  });

  it("rejects archiving and deleting system pages", async () => {
    const systemDoc = { id: "doc-sys", relative_path: "wiki/overview.md", source_kind: "wiki" };
    const app = makeApp(makeMockStore({ getDocument: vi.fn().mockResolvedValue(systemDoc) }));
    const archiveRes = await app.request("/api/v1/documents/doc-sys/archive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "test" }),
    });
    expect(archiveRes.status).toBe(400);
    const deleteRes = await app.request("/api/v1/documents/doc-sys", { method: "DELETE" });
    expect(deleteRes.status).toBe(400);
  });

  it("POST /api/v1/documents/:id/archive and /reopen validate and apply changes", async () => {
    const sampleDoc = {
      id: "doc-exp",
      user_id: "default",
      filename: "pg-pool.md",
      title: "PG Pool",
      path: "/wiki/experiences/",
      relative_path: "wiki/experiences/pg-pool.md",
      source_kind: "wiki",
      file_type: "md",
      file_size: 40,
      document_number: 1,
      status: "ready",
      page_count: 1,
      content: "---\ntitle: PG Pool\ntype: experience\nkind: pitfall\nstatus: draft\nconfidence: low\ndate: 2026-11-20\n---\n\n# 适用场景\n",
      tags: [],
      date: "2026-11-20",
      metadata: "{}",
      error_message: "",
      version: 1,
      parser: "",
      content_hash: "h1",
      stale_since: "",
      highlights: "[]",
      created_at: "",
      updated_at: "",
      page_type: "experience",
      archived_at: "",
    };
    let currentDoc = { ...sampleDoc };
    const store = makeMockStore({
      getDocument: vi.fn().mockImplementation(async (id) => (id === "doc-exp" ? currentDoc : null)),
      getDocumentByRelativePath: vi.fn().mockResolvedValue(currentDoc),
      applyChangeSet: vi.fn().mockImplementation(async (_cs, writes) => {
        if (writes[0]?.document) currentDoc = { ...writes[0].document };
      }),
      replaceReferenceEntriesInTx: vi.fn().mockResolvedValue(undefined),
      replaceReferencesInTx: vi.fn().mockResolvedValue(undefined),
      listDocumentsWithContent: vi.fn().mockImplementation(async () => [currentDoc]),
      listSourceBlobs: vi.fn().mockResolvedValue([]),
    });
    const app = makeApp(store);

    const badArchive = await app.request("/api/v1/documents/doc-exp/archive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "   " }),
    });
    expect(badArchive.status).toBe(400);

    const archRes = await app.request("/api/v1/documents/doc-exp/archive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "已替代", superseded_by: "[[new-pool]]", date: "2026-11-25" }),
    });
    expect(archRes.status).toBe(200);
    const archivedBody = (await archRes.json()) as { archived_at: string; archive_reason: string };
    expect(archivedBody.archived_at).toBe("2026-11-25");
    expect(archivedBody.archive_reason).toBe("已替代");

    const lintRes = await app.request("/api/v1/lint");
    expect(lintRes.status).toBe(200);
    const lintBody = (await lintRes.json()) as { stats: { archived: number } };
    expect(lintBody.stats.archived).toBe(1);

    const reopenRes = await app.request("/api/v1/documents/doc-exp/reopen", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "重新核实", confidence: "high", last_verified: "2026-11-25", date: "2026-11-25" }),
    });
    expect(reopenRes.status).toBe(200);
    const reopenedBody = (await reopenRes.json()) as { archived_at: string; confidence: string };
    expect(reopenedBody.archived_at).toBe("");
    expect(reopenedBody.confidence).toBe("high");
  });
});
