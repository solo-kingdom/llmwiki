import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { defaultToolPolicy } from "../mcp/policy.js";
import { McpServer } from "../mcp/server.js";
import { registerTools } from "../mcp/tools.js";
import { createApp } from "../server/app.js";
import type { Store } from "../store/interfaces.js";
import { buildArchiveRelativePath, normalizeArchiveFolderPath } from "../store/postgres/archives.js";
import type { ArchiveFile, Document, IngestJob, PageWrite } from "../store/types.js";

function sha256(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

function makeBatchEnv() {
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
        file_size: 20,
        document_number: 1,
        status: "ready",
        page_count: 1,
        content: "---\ntitle: Alpha\ntype: concept\ndate: 2026-11-28\n---\n\n# Alpha\nLine one\nLine two",
        tags: ["api", "batch"],
        date: "2026-11-28",
        metadata: "{}",
        error_message: "",
        version: 1,
        parser: "",
        content_hash: "",
        stale_since: "",
        highlights: "[]",
        created_at: "",
        updated_at: "",
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
        file_size: 30,
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
        content_hash: "",
        stale_since: "",
        highlights: "[]",
        created_at: "",
        updated_at: "",
        page_type: "entity",
      },
    ],
    [
      "doc-3",
      {
        id: "doc-3",
        user_id: "default",
        filename: "gamma.md",
        title: "Gamma",
        path: "/wiki/dev/",
        relative_path: "wiki/dev/gamma.md",
        source_kind: "wiki",
        file_type: "md",
        file_size: 20,
        document_number: 3,
        status: "ready",
        page_count: 1,
        content: "---\ntitle: Gamma\ntype: concept\ndate: 2026-11-28\n---\n\nOld note.",
        tags: ["api"],
        date: "2026-11-28",
        metadata: "{}",
        error_message: "",
        version: 1,
        parser: "",
        content_hash: "",
        stale_since: "",
        highlights: "[]",
        created_at: "",
        updated_at: "",
        page_type: "concept",
      },
    ],
  ]);
  for (const d of docs.values()) d.content_hash = sha256(d.content);

  const archiveFiles = new Map<string, ArchiveFile>([
    [
      "af-1",
      {
        id: "af-1",
        folder_path: "docs",
        filename: "a.md",
        title: "A",
        relative_path: "docs/a.md",
        media_type: "text/markdown; charset=utf-8",
        kind: "markdown",
        size: 7,
        sha256: sha256("hello a"),
        storage_backend: "db",
        storage_key: "",
        origin: "upload",
        source_ref: "",
        ingest_job_id: "",
        created_at: "",
        updated_at: "",
      },
    ],
    [
      "af-2",
      {
        id: "af-2",
        folder_path: "docs",
        filename: "b.bin",
        title: "B",
        relative_path: "docs/b.bin",
        media_type: "application/octet-stream",
        kind: "other",
        size: 3,
        sha256: "bsha",
        storage_backend: "db",
        storage_key: "",
        origin: "upload",
        source_ref: "",
        ingest_job_id: "",
        created_at: "",
        updated_at: "",
      },
    ],
  ]);
  const archiveBytes = new Map<string, Uint8Array>([
    ["af-1", Buffer.from("hello a", "utf8")],
    ["af-2", Buffer.from([1, 2, 3])],
  ]);
  const links: Array<{ docId: string; afId: string }> = [];
  const jobs: IngestJob[] = [];
  const changeSets: Array<{ id: string; writes: PageWrite[] }> = [];

  const store = {
    getConfig: vi.fn().mockResolvedValue(""),
    getAllConfig: vi.fn().mockResolvedValue({ archive_inline_max_bytes: "131072" }),
    countActivityLogs: vi.fn().mockResolvedValue(0),
    createActivityLog: vi.fn().mockResolvedValue(undefined),
    getDocument: vi.fn(async (id: string) => docs.get(id) ?? null),
    getDocumentByRelativePath: vi.fn(async (rel: string) => {
      for (const d of docs.values()) if (d.relative_path === rel) return d;
      return null;
    }),
    listDocumentsFiltered: vi.fn(async () => [...docs.values()]),
    listDocumentsWithContent: vi.fn(async () => [...docs.values()]),
    listFolders: vi.fn().mockResolvedValue([]),
    listReferenceEntries: vi.fn().mockResolvedValue([]),
    replaceReferenceEntriesInTx: vi.fn().mockResolvedValue(undefined),
    replaceReferencesInTx: vi.fn().mockResolvedValue(undefined),
    applyChangeSet: vi.fn(async (cs, writes: PageWrite[]) => {
      changeSets.push({ id: cs.id, writes });
      for (const w of writes) {
        if (!w.document || w.operation === "delete") {
          for (const [k, d] of docs) {
            if (d.relative_path === w.relative_path) docs.delete(k);
          }
        } else {
          const prev = docs.get(w.document.id);
          docs.set(w.document.id, { ...w.document, version: (prev?.version ?? 0) + 1 });
        }
      }
    }),
    getArchiveFile: vi.fn(async (id: string) => archiveFiles.get(id) ?? null),
    getArchiveFileByRelativePath: vi.fn(async (rel: string) => {
      for (const f of archiveFiles.values()) if (f.relative_path === rel) return f;
      return null;
    }),
    getArchiveFileInlineBytes: vi.fn(async (id: string) => archiveBytes.get(id) ?? null),
    createArchiveFile: vi.fn(async (file: ArchiveFile, inlineBytes: Uint8Array | null) => {
      const saved = { ...file, id: file.id || randomUUID() };
      archiveFiles.set(saved.id, saved);
      if (inlineBytes) archiveBytes.set(saved.id, inlineBytes);
      return saved;
    }),
    updateArchiveFileLocation: vi.fn(async (id: string, folderPath: string, filename: string) => {
      const f = archiveFiles.get(id)!;
      const nf = normalizeArchiveFolderPath(folderPath);
      const updated = { ...f, folder_path: nf, filename, relative_path: buildArchiveRelativePath(nf, filename) };
      archiveFiles.set(id, updated);
      return updated;
    }),
    deleteArchiveFile: vi.fn(async (id: string) => {
      const f = archiveFiles.get(id) ?? null;
      archiveFiles.delete(id);
      archiveBytes.delete(id);
      return f;
    }),
    createIngestJob: vi.fn(async (job: IngestJob) => {
      job.id = randomUUID();
      jobs.push({ ...job });
    }),
    getJobEventsMaxCount: vi.fn().mockResolvedValue(200),
    insertIngestJobEvent: vi.fn().mockResolvedValue(undefined),
    linkDocumentArchiveSource: vi.fn(async (docId: string, afId: string) => {
      links.push({ docId, afId });
    }),
    unlinkDocumentArchiveSource: vi.fn(async (docId: string, afId: string) => {
      const idx = links.findIndex((l) => l.docId === docId && l.afId === afId);
      if (idx < 0) return false;
      links.splice(idx, 1);
      return true;
    }),
  } as unknown as Store;

  const app = createApp({
    db: store,
    token: "",
    publicWiki: false,
    noMcp: true,
    mcpAllowWrite: false,
    workspace: "",
    webRoot: "/tmp/nonexistent-web",
    skillsRoot: path.resolve(process.cwd(), "skills"),
  });

  return { app, store, docs, archiveFiles, changeSets, links, jobs };
}

describe("s3 atomic batch & bulk operations", () => {
  it("executes mixed wiki batch in a single change_set with link rewrite, dry_run, and atomic rollback on failure", async () => {
    const { app, docs, changeSets } = makeBatchEnv();

    // Fail atomically on op[1] version conflict -> op[0] create must NOT persist
    const failRes = await app.request("/api/v1/documents/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ops: [
          { op: "create", path: "/wiki/dev", filename: "delta.md", title: "Delta", content: "---\ntitle: Delta\ntype: concept\ndate: 2026-11-28\n---\n\nHi" },
          { op: "patch", id: "doc-1", edits: [{ op: "replace", old_text: "Line one", new_text: "X" }], expected_version: 99 },
        ],
      }),
    });
    expect(failRes.status).toBe(409);
    expect(changeSets).toHaveLength(0);
    expect(docs.size).toBe(3);

    // dry_run succeeds with preview and zero DB writes
    const dryRes = await app.request("/api/v1/documents/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dry_run: true,
        ops: [
          { op: "move", id: "doc-1", target_folder: "arch" },
          { op: "delete", id: "doc-3" },
        ],
      }),
    });
    expect(dryRes.status).toBe(200);
    const dryBody = (await dryRes.json()) as { dry_run: boolean; rewritten_link_pages: string[] };
    expect(dryBody.dry_run).toBe(true);
    expect(dryBody.rewritten_link_pages).toContain("wiki/dev/beta.md");
    expect(changeSets).toHaveLength(0);

    // Real atomic execution: patch + move + archive + delete in 1 change_set
    const okRes = await app.request("/api/v1/documents/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        summary: "reorganize dev docs",
        ops: [
          { op: "patch", id: "doc-1", edits: [{ op: "replace", old_text: "Line one", new_text: "Line 1" }] },
          { op: "move", id: "doc-1", target_folder: "arch" },
          { op: "delete", id: "doc-3" },
        ],
      }),
    });
    expect(okRes.status).toBe(200);
    const okBody = (await okRes.json()) as { change_set_id: string; rewritten_link_pages: string[] };
    expect(okBody.change_set_id).toBeTruthy();
    expect(okBody.rewritten_link_pages).toContain("wiki/dev/beta.md");
    expect(changeSets[0]?.id).toBe(okBody.change_set_id);
    expect(changeSets[0]?.writes.length).toBeGreaterThanOrEqual(3);
    expect(docs.get("doc-1")!.relative_path).toBe("wiki/arch/alpha.md");
    expect(docs.get("doc-2")!.content).toContain("[[arch/alpha|Alpha]]");
    expect(docs.has("doc-3")).toBe(false);
  });

  it("supports batch-get (meta/outline/content) and auto-cluster batch_ops", async () => {
    const { app } = makeBatchEnv();
    const res = await app.request("/api/v1/documents/batch-get", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ids: ["doc-1"],
        paths: ["dev/beta.md", "wiki/missing.md"],
        fields: "outline",
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      documents: Array<{ id: string; content: string; outline: string[] }>;
      not_found: string[];
    };
    expect(body.documents).toHaveLength(2);
    expect(body.documents[0]!.content).toBe("");
    expect(body.documents[0]!.outline).toContain("L7: # Alpha");
    expect(body.not_found).toEqual(["wiki/missing.md"]);

    const clusterRes = await app.request("/api/v1/organize/auto-cluster", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folder: "dev", min_cluster_size: 3 }),
    });
    expect(clusterRes.status).toBe(200);
    const clusterBody = (await clusterRes.json()) as { batch_ops: Array<{ op: string; id: string }> };
    expect(clusterBody.batch_ops).toHaveLength(3);
    expect(clusterBody.batch_ops[0]?.op).toBe("move");
  });

  it("supports archive batch-get, bulk-move, bulk-ingest, bulk-link, bulk-delete, and relative_paths upload", async () => {
    const { app, archiveFiles, jobs, links } = makeBatchEnv();

    const getRes = await app.request("/api/v1/archives/files/batch-get", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: ["af-1", "missing"], include_text: true }),
    });
    expect(getRes.status).toBe(200);
    const getBody = (await getRes.json()) as { files: Array<{ text?: string }>; not_found: string[] };
    expect(getBody.files[0]?.text).toBe("hello a");
    expect(getBody.not_found).toEqual(["missing"]);

    // Upload with relative_paths
    const form = new FormData();
    form.append("folder_path", "bundle");
    form.append("files", new File(["one"], "one.md", { type: "text/markdown" }));
    form.append("files", new File(["two"], "two.md", { type: "text/markdown" }));
    form.append("relative_paths", JSON.stringify(["sub1/one.md", "sub2/two.md"]));
    const upRes = await app.request("/api/v1/archives/files", { method: "POST", body: form });
    expect(upRes.status).toBe(201);
    const upBody = (await upRes.json()) as { files: ArchiveFile[] };
    expect(upBody.files.map((f) => f.relative_path)).toEqual(["bundle/sub1/one.md", "bundle/sub2/two.md"]);

    // Duplicate upload without overwrite returns 409 atomically
    const dupForm = new FormData();
    dupForm.append("folder_path", "docs");
    dupForm.append("files", new File(["new"], "new.md"));
    dupForm.append("files", new File(["dup"], "a.md"));
    const dupRes = await app.request("/api/v1/archives/files", { method: "POST", body: dupForm });
    expect(dupRes.status).toBe(409);
    expect([...archiveFiles.values()].some((f) => f.relative_path === "docs/new.md")).toBe(false);

    // bulk-move, bulk-ingest, bulk-link, bulk-delete
    const mvRes = await app.request("/api/v1/archives/files/bulk-move", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: [{ id: "af-1", folder_path: "archive-new" }] }),
    });
    expect(mvRes.status).toBe(200);
    expect(archiveFiles.get("af-1")!.relative_path).toBe("archive-new/a.md");

    const ingRes = await app.request("/api/v1/archives/files/bulk-ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: ["af-1", "af-2"] }),
    });
    expect(ingRes.status).toBe(201);
    expect(jobs).toHaveLength(1);

    const linkRes = await app.request("/api/v1/archives/files/bulk-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "link", items: [{ document_id: "doc-1", archive_file_id: "af-1" }] }),
    });
    expect(linkRes.status).toBe(200);
    expect(links).toHaveLength(1);

    const delRes = await app.request("/api/v1/archives/files/bulk-delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: ["af-2"] }),
    });
    expect(delRes.status).toBe(200);
    expect(archiveFiles.has("af-2")).toBe(false);
  });

  it("exposes MCP batch_read, batch_write, and archive_batch with readonly guard", async () => {
    const { store, docs } = makeBatchEnv();
    const server = new McpServer("LLM Wiki", "");
    registerTools(server, "", store);
    server.setToolPolicy(defaultToolPolicy(false));

    const readRes = await server.handleRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "batch_read", arguments: { ids: ["doc-1"], fields: "meta" } },
    });
    expect(readRes?.error).toBeUndefined();

    const blockedWrite = await server.handleRequest({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "batch_write", arguments: { ops: [{ op: "delete", id: "doc-3" }] } },
    });
    expect(blockedWrite?.error?.message).toContain("disabled by policy");

    const blockedArchiveBatch = await server.handleRequest({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "archive_batch", arguments: { action: "get", ids: ["af-1"] } },
    });
    expect(blockedArchiveBatch?.error?.message).toContain("disabled by policy");

    server.setToolPolicy(defaultToolPolicy(true));
    const writeRes = await server.handleRequest({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "batch_write",
        arguments: {
          ops: [{ op: "patch", id: "doc-1", edits: [{ op: "append", text: "Added via MCP batch" }] }],
        },
      },
    });
    const text = (writeRes?.result as { content: Array<{ text: string }> }).content[0]!.text;
    expect(text).toContain("Batch applied:");
    expect(docs.get("doc-1")!.content).toContain("Added via MCP batch");
  });
});
