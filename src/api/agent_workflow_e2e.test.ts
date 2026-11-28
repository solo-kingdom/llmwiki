import { createHash } from "node:crypto";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../server/app.js";
import type { Store } from "../store/interfaces.js";
import { FolderConflictError } from "../store/postgres/folders.js";
import type { ArchiveFile, Document, PageWrite } from "../store/types.js";

function sha256(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

function makeE2EApp() {
  const docs = new Map<string, Document>([
    [
      "doc-1",
      {
        id: "doc-1",
        user_id: "default",
        filename: "alpha.md",
        title: "Alpha",
        path: "/wiki/dev/",
        relative_path: "wiki/dev/alpha.md",
        source_kind: "wiki",
        file_type: "md",
        file_size: 80,
        document_number: 1,
        status: "ready",
        page_count: 1,
        content: "---\ntitle: Alpha\ntype: concept\ndate: 2026-11-28\n---\n\n# Alpha\nLine one",
        tags: ["api"],
        date: "2026-11-28",
        metadata: "{}",
        error_message: "",
        version: 1,
        parser: "",
        content_hash: sha256("---\ntitle: Alpha\ntype: concept\ndate: 2026-11-28\n---\n\n# Alpha\nLine one"),
        stale_since: "",
        highlights: "[]",
        created_at: "2026-11-28 09:00:00",
        updated_at: "2026-11-28 09:00:00",
        page_type: "concept",
      },
    ],
    [
      "doc-2",
      {
        id: "doc-2",
        user_id: "default",
        filename: "beta.md",
        title: "Beta",
        path: "/wiki/dev/",
        relative_path: "wiki/dev/beta.md",
        source_kind: "wiki",
        file_type: "md",
        file_size: 80,
        document_number: 2,
        status: "ready",
        page_count: 1,
        content: "---\ntitle: Beta\ntype: entity\ndate: 2026-11-28\n---\n\nSee [[dev/alpha|Alpha]].",
        tags: ["api"],
        date: "2026-11-28",
        metadata: "{}",
        error_message: "",
        version: 1,
        parser: "",
        content_hash: sha256("---\ntitle: Beta\ntype: entity\ndate: 2026-11-28\n---\n\nSee [[dev/alpha|Alpha]]."),
        stale_since: "",
        highlights: "[]",
        created_at: "2026-11-28 09:00:00",
        updated_at: "2026-11-28 09:00:00",
        page_type: "entity",
      },
    ],
  ]);

  const folders = new Set<string>(["dev", "archive-topic"]);
  const changeSets: Array<{ id: string; summary?: string }> = [];
  const archiveFile: ArchiveFile = {
    id: "af-1",
    folder_path: "specs",
    filename: "alpha-spec.md",
    title: "Alpha Spec",
    relative_path: "specs/alpha-spec.md",
    media_type: "text/markdown",
    kind: "markdown",
    size: 20,
    sha256: "af-sha-1",
    storage_backend: "db",
    storage_key: "",
    origin: "upload",
    source_ref: "",
    ingest_job_id: "",
    created_at: "2026-11-28 09:00:00",
    updated_at: "2026-11-28 09:00:00",
  };

  const db = {
    getDocument: vi.fn(async (id: string) => docs.get(id) ?? null),
    getDocumentByRelativePath: vi.fn(async (rel: string) => {
      for (const d of docs.values()) {
        if (d.relative_path === rel) return d;
      }
      return null;
    }),
    getDocumentByPath: vi.fn(async (filename: string, dirPath: string) => {
      for (const d of docs.values()) {
        if (d.filename === filename && d.path === dirPath) return d;
      }
      return null;
    }),
    listDocuments: vi.fn(async () => [...docs.values()]),
    listDocumentsFiltered: vi.fn(async () => [...docs.values()]),
    listFolders: vi.fn(async () =>
      [...folders].map((p) => ({
        path: p,
        display_name: p,
        description: "",
        sort_order: 0,
        created_at: "",
        updated_at: "",
        direct_count: 0,
        total_count: 0,
      })),
    ),
    getFolder: vi.fn(async (p: string) =>
      folders.has(p) ? { path: p, display_name: p, description: "", sort_order: 0, created_at: "", updated_at: "" } : null,
    ),
    createFolder: vi.fn(async (input: { path: string }) => {
      if (folders.has(input.path)) {
        throw new FolderConflictError(`folder already exists: ${input.path}`);
      }
      folders.add(input.path);
      return { path: input.path, display_name: input.path, description: "", sort_order: 0, created_at: "", updated_at: "" };
    }),
    ensureFolders: vi.fn(async (paths: string[]) => {
      for (const p of paths) folders.add(p);
    }),
    moveFolder: vi.fn(async (fromPath: string, toPath: string) => {
      folders.delete(fromPath);
      folders.add(toPath);
      return {
        from_path: fromPath,
        to_path: toPath,
        moved_folders: 1,
        moved_documents: 0,
        moved_doc_paths: [],
        change_set_id: "cs-folder-move",
        updated_link_paths: [],
      };
    }),
    applyChangeSet: vi.fn(async (cs: { id: string; summary?: string }, writes: PageWrite[]) => {
      changeSets.push({ id: cs.id, summary: cs.summary });
      for (const w of writes) {
        if (w.document) {
          const existing = docs.get(w.document.id);
          docs.set(w.document.id, {
            ...w.document,
            version: (existing?.version ?? w.document.version ?? 0) + 1,
            content_hash: sha256(w.document.content),
          });
        }
      }
    }),
    searchChunks: vi.fn(async () => {
      const d = docs.get("doc-1")!;
      return [
        {
          document_id: d.id,
          content: d.content,
          page: 1,
          header_breadcrumb: "Alpha",
          chunk_index: 0,
          filename: d.filename,
          title: d.title,
          path: d.path,
          file_type: d.file_type,
          page_type: d.page_type,
          score: 1.0,
        },
      ];
    }),
    searchArchiveFiles: vi.fn(async () => [
      { file: archiveFile, match_type: "title" as const, snippet: "Alpha Spec", score: 2.0 },
    ]),
    getConfig: vi.fn(async () => ""),
    listProviderInstances: vi.fn(async () => []),
    listReferenceEntries: vi.fn(async () => []),
    replaceReferenceEntriesInTx: vi.fn(async () => {}),
    mergeReferenceEntriesInTx: vi.fn(async () => {}),
    replaceReferencesInTx: vi.fn(async () => {}),
    getJobEventsMaxCount: vi.fn(async () => 200),
    insertIngestJobEvent: vi.fn(async () => {}),
    createActivityLog: vi.fn(async () => {}),
  } as unknown as Store;

  const app = createApp({
    db,
    token: "",
    publicWiki: true,
    noMcp: true,
    mcpAllowWrite: false,
    workspace: "",
    webRoot: "/tmp/nonexistent-web",
    skillsRoot: path.resolve(process.cwd(), "skills"),
  });

  return { app, docs, changeSets };
}

describe("end-to-end agent API workflow (s1-s4 integrated)", () => {
  it("runs search -> by-path -> optimistic patch -> folder merge -> dry_run/commit batch -> batch-get -> skills", async () => {
    const { app, changeSets } = makeE2EApp();

    // 1. Unified search (scope=all) with observable degradation
    const searchRes = await app.request("/api/v1/search?q=Alpha&scope=all");
    expect(searchRes.status).toBe(200);
    const searchBody = (await searchRes.json()) as {
      scope: string;
      effective_mode: string;
      degraded_reason?: string;
      results: Array<{ relative_path?: string }>;
      archive_results: Array<{ file: { relative_path: string } }>;
    };
    expect(searchBody.scope).toBe("all");
    expect(searchBody.effective_mode).toBe("keyword");
    expect(searchBody.degraded_reason).toContain("embedding unavailable");
    expect(searchBody.results[0]?.relative_path).toBe("wiki/dev/alpha.md");
    expect(searchBody.archive_results[0]?.file.relative_path).toBe("specs/alpha-spec.md");

    // 2. Direct path addressing without body
    const byPathRes = await app.request("/api/v1/documents/by-path?path=wiki/dev/alpha.md&include_content=false");
    expect(byPathRes.status).toBe(200);
    const byPathDoc = (await byPathRes.json()) as { id: string; version: number; content: string };
    expect(byPathDoc.id).toBe("doc-1");
    expect(byPathDoc.version).toBe(1);
    expect(byPathDoc.content).toBe("");

    // 3. Optimistic-locked partial patch (stale -> 409, matching -> 200)
    const stalePatch = await app.request("/api/v1/documents/doc-1/content", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        expected_version: 99,
        edits: [{ op: "replace", old_text: "Line one", new_text: "Line one (edited)" }],
      }),
    });
    expect(stalePatch.status).toBe(409);

    const okPatch = await app.request("/api/v1/documents/doc-1/content", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        expected_version: 1,
        edits: [{ op: "replace", old_text: "Line one", new_text: "Line one (edited)" }],
      }),
    });
    expect(okPatch.status).toBe(200);

    // 4. Idempotent mkdir + folder merge
    const mkdirRes = await app.request("/api/v1/folders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "dev", exist_ok: true }),
    });
    expect(mkdirRes.status).toBe(200);

    const mergeRes = await app.request("/api/v1/folders/move", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from_path: "dev", to_path: "archive-topic", on_conflict: "merge" }),
    });
    expect(mergeRes.status).toBe(200);

    // 5. Batch dry_run -> commit -> batch-get
    const dryRes = await app.request("/api/v1/documents/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dry_run: true,
        summary: "e2e batch",
        ops: [
          {
            op: "patch",
            id: "doc-1",
            expected_version: 2,
            edits: [{ op: "append", text: "\nLine two" }],
          },
          { op: "move", id: "doc-2", target_folder: "archive-topic" },
        ],
      }),
    });
    expect(dryRes.status).toBe(200);
    const csBefore = changeSets.length;

    const batchRes = await app.request("/api/v1/documents/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dry_run: false,
        summary: "e2e batch",
        ops: [
          {
            op: "patch",
            id: "doc-1",
            expected_version: 2,
            edits: [{ op: "append", text: "\nLine two" }],
          },
          { op: "move", id: "doc-2", target_folder: "archive-topic" },
        ],
      }),
    });
    expect(batchRes.status).toBe(200);
    expect(changeSets.length).toBeGreaterThan(csBefore);

    const batchGetRes = await app.request("/api/v1/documents/batch-get", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: ["doc-1", "doc-2"], fields: "content" }),
    });
    expect(batchGetRes.status).toBe(200);
    const batchGetBody = (await batchGetRes.json()) as {
      documents: Array<{ id: string; relative_path: string; content: string }>;
    };
    expect(batchGetBody.documents.find((d) => d.id === "doc-1")?.content).toContain("Line two");
    expect(batchGetBody.documents.find((d) => d.id === "doc-2")?.relative_path).toBe("wiki/archive-topic/beta.md");

    // 6. Skill discovery parity
    const orgSkill = await (await app.request("/skills/llmwiki-organize.md")).text();
    const qrySkill = await (await app.request("/skills/llmwiki-query.md")).text();
    const arcSkill = await (await app.request("/skills/llmwiki-archive.md")).text();
    expect(orgSkill).toContain("/api/v1/documents/{id}/content");
    expect(orgSkill).toContain("PATCH");
    expect(orgSkill).toContain("POST /api/v1/documents/batch");
    expect(qrySkill).toContain("scope");
    expect(arcSkill).toContain("archive_search");
  });
});
