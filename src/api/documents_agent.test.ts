import { randomUUID } from "node:crypto";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../server/app.js";
import type { Store } from "../store/interfaces.js";
import { ArchiveConflictError, normalizeArchiveFolderPath } from "../store/postgres/archives.js";
import { FolderConflictError } from "../store/postgres/folders.js";
import type { ArchiveFile, ArchiveFolder, Document, WikiFolder } from "../store/types.js";

function makeStore() {
  const docs = new Map<string, Document>([
    [
      "doc-1",
      {
        id: "doc-1",
        user_id: "default",
        filename: "a.md",
        title: "Doc A",
        path: "/wiki/dev/api/",
        relative_path: "wiki/dev/api/a.md",
        source_kind: "wiki",
        file_type: "md",
        file_size: 10,
        document_number: 1,
        status: "ready",
        page_count: 1,
        content: "# Doc A\n\nBody",
        tags: ["api", "agent"],
        date: "2026-11-28",
        metadata: "{}",
        error_message: "",
        version: 1,
        parser: "",
        content_hash: "h1",
        stale_since: "",
        highlights: "[]",
        created_at: "2026-11-28 00:00:00",
        updated_at: "2026-11-28 10:00:00",
        page_type: "concept",
      },
    ],
    [
      "doc-2",
      {
        id: "doc-2",
        user_id: "default",
        filename: "b.md",
        title: "Doc B",
        path: "/wiki/ops/",
        relative_path: "wiki/ops/b.md",
        source_kind: "wiki",
        file_type: "md",
        file_size: 10,
        document_number: 2,
        status: "ready",
        page_count: 1,
        content: "# Doc B",
        tags: ["ops"],
        date: "2026-11-28",
        metadata: "{}",
        error_message: "",
        version: 1,
        parser: "",
        content_hash: "h2",
        stale_since: "",
        highlights: "[]",
        created_at: "2026-11-27 00:00:00",
        updated_at: "2026-11-27 10:00:00",
        page_type: "entity",
      },
    ],
  ]);
  const wikiFolders = new Map<string, WikiFolder>([
    ["dev", { path: "dev", display_name: "Dev", description: "", sort_order: 0, created_at: "", updated_at: "" }],
  ]);
  const archiveFolders = new Map<string, ArchiveFolder>([
    ["specs", { path: "specs", display_name: "Specs", description: "", sort_order: 0, created_at: "", updated_at: "" }],
    ["notes", { path: "notes", display_name: "Notes", description: "", sort_order: 0, created_at: "", updated_at: "" }],
  ]);
  const archiveFiles = new Map<string, ArchiveFile>([
    [
      "af-1",
      {
        id: "af-1",
        folder_path: "specs",
        filename: "spec.md",
        title: "Spec",
        relative_path: "specs/spec.md",
        media_type: "text/markdown; charset=utf-8",
        kind: "markdown",
        size: 5,
        sha256: "abc",
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
        folder_path: "notes",
        filename: "n.md",
        title: "Note",
        relative_path: "notes/n.md",
        media_type: "text/markdown; charset=utf-8",
        kind: "markdown",
        size: 5,
        sha256: "def",
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

  const store = {
    getConfig: vi.fn().mockResolvedValue(""),
    getAllConfig: vi.fn().mockResolvedValue({ archive_inline_max_bytes: "131072" }),
    countActivityLogs: vi.fn().mockResolvedValue(0),
    createActivityLog: vi.fn().mockResolvedValue(undefined),
    listDocumentsFiltered: vi.fn(async () => [...docs.values()]),
    getDocument: vi.fn(async (id: string) => docs.get(id) ?? null),
    getDocumentByRelativePath: vi.fn(async (rel: string) => {
      for (const d of docs.values()) {
        if (d.relative_path === rel) return d;
      }
      return null;
    }),
    listReferenceEntries: vi.fn().mockResolvedValue([]),
    listDocumentArchiveSources: vi.fn().mockResolvedValue([]),
    createFolder: vi.fn(async (input: { path: string }) => {
      if (wikiFolders.has(input.path)) throw new FolderConflictError(`exists: ${input.path}`);
      const f: WikiFolder = { path: input.path, display_name: input.path, description: "", sort_order: 0, created_at: "", updated_at: "" };
      wikiFolders.set(input.path, f);
      return f;
    }),
    getFolder: vi.fn(async (p: string) => wikiFolders.get(p) ?? null),
    listArchiveFolders: vi.fn(async () => [...archiveFolders.values()].map((f) => ({ ...f, direct_count: 1, total_count: 1 }))),
    getArchiveFolder: vi.fn(async (p: string) => archiveFolders.get(normalizeArchiveFolderPath(p)) ?? null),
    createArchiveFolder: vi.fn(async (input: { path: string }) => {
      const p = normalizeArchiveFolderPath(input.path);
      if (archiveFolders.has(p)) throw new ArchiveConflictError(`exists: ${p}`);
      const f: ArchiveFolder = { path: p, display_name: p, description: "", sort_order: 0, created_at: "", updated_at: "" };
      archiveFolders.set(p, f);
      return f;
    }),
    listArchiveFiles: vi.fn(async (filter: { folder_path?: string } = {}) => {
      const all = [...archiveFiles.values()];
      if (!filter.folder_path) return all;
      return all.filter((f) => f.folder_path === filter.folder_path || f.folder_path.startsWith(`${filter.folder_path}/`));
    }),
    getArchiveFile: vi.fn(async (id: string) => archiveFiles.get(id) ?? null),
    getArchiveFileByRelativePath: vi.fn(async (rel: string) => {
      for (const f of archiveFiles.values()) {
        if (f.relative_path === rel) return f;
      }
      return null;
    }),
    createArchiveFile: vi.fn(async (file: ArchiveFile) => {
      const saved = { ...file, id: file.id || randomUUID() };
      archiveFiles.set(saved.id, saved);
      return saved;
    }),
    updateArchiveFileMeta: vi.fn(async (id: string, patch: { title?: string; source_ref?: string }) => {
      const f = archiveFiles.get(id);
      if (!f) return null;
      if (patch.title !== undefined) f.title = patch.title;
      if (patch.source_ref !== undefined) f.source_ref = patch.source_ref;
      return f;
    }),
  } as unknown as Store;

  return createApp({
    db: store,
    token: "",
    publicWiki: false,
    noMcp: true,
    mcpAllowWrite: false,
    workspace: "",
    webRoot: "/tmp/nonexistent-web",
    skillsRoot: path.resolve(process.cwd(), "skills"),
  });
}

describe("s1 HTTP API agent parity", () => {
  it("supports GET /api/v1/documents/by-path with include_content", async () => {
    const app = makeStore();
    expect((await app.request("/api/v1/documents/by-path")).status).toBe(400);
    expect((await app.request("/api/v1/documents/by-path?path=wiki/missing.md")).status).toBe(404);

    const res = await app.request("/api/v1/documents/by-path?path=dev/api/a.md&include_content=false");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; content: string; content_length: number };
    expect(body.id).toBe("doc-1");
    expect(body.content).toBe("");
    expect(body.content_length).toBeGreaterThan(0);
  });

  it("supports folder, tags, and paginated listing on GET /api/v1/documents", async () => {
    const app = makeStore();
    const res = await app.request("/api/v1/documents?folder=dev&tags=api&tags=agent&tag_mode=all&paginated=true&limit=10");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Document[]; total: number; has_more: boolean };
    expect(body.total).toBe(1);
    expect(body.items[0]?.id).toBe("doc-1");
    expect(body.has_more).toBe(false);
  });

  it("supports exist_ok on wiki and archive folder creation", async () => {
    const app = makeStore();
    const wikiRes = await app.request("/api/v1/folders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "dev", exist_ok: true }),
    });
    expect(wikiRes.status).toBe(200);

    const archRes = await app.request("/api/v1/archives/folders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "specs", exist_ok: true }),
    });
    expect(archRes.status).toBe(200);
  });

  it("supports folder filter on archives/tree, title/source_ref patch, and JSON upload", async () => {
    const app = makeStore();
    const treeRes = await app.request("/api/v1/archives/tree?folder=specs");
    expect(treeRes.status).toBe(200);
    const tree = (await treeRes.json()) as { folders: ArchiveFolder[]; files: ArchiveFile[] };
    expect(tree.folders).toHaveLength(1);
    expect(tree.files).toHaveLength(1);
    expect(tree.files[0]?.id).toBe("af-1");

    const patchRes = await app.request("/api/v1/archives/files/af-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Updated Title", source_ref: "manual:v2" }),
    });
    expect(patchRes.status).toBe(200);
    const patched = (await patchRes.json()) as ArchiveFile;
    expect(patched.title).toBe("Updated Title");
    expect(patched.source_ref).toBe("manual:v2");

    const jsonUpload = await app.request("/api/v1/archives/files", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: "hello.txt",
        folder_path: "specs",
        content: "hello json upload",
        title: "Hello",
      }),
    });
    expect(jsonUpload.status).toBe(201);
    const uploaded = (await jsonUpload.json()) as { file: ArchiveFile };
    expect(uploaded.file.relative_path).toBe("specs/hello.txt");
  });
});
