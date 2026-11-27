import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../server/app.js";
import type { Store } from "../store/interfaces.js";
import { buildArchiveRelativePath, normalizeArchiveFolderPath } from "../store/postgres/archives.js";
import type { ArchiveFile, ArchiveFolder, ArchiveSourceSummary, ChangeSet, Document, IngestJob } from "../store/types.js";
import { applyBlocksToStore } from "./dbapply.js";

function createIngestArchiveMockStore() {
  const config = new Map<string, string>();
  const folders = new Map<string, ArchiveFolder>();
  const files = new Map<string, ArchiveFile>();
  const inlineMap = new Map<string, Uint8Array | null>();
  const jobs = new Map<string, IngestJob>();
  const docs = new Map<string, Document>();
  const changeSets = new Map<string, ChangeSet>();
  const docArchiveLinks: Array<{ documentId: string; archiveFileId: string; changeSetId: string; relation: string }> = [];

  const store = {
    getAllConfig: vi.fn(async () => Object.fromEntries(config.entries())),
    getConfig: vi.fn(async (k: string) => config.get(k) ?? ""),
    countActivityLogs: vi.fn().mockResolvedValue(0),
    createActivityLog: vi.fn().mockResolvedValue(undefined),
    ensureArchiveFolders: vi.fn(async (paths: string[]) => {
      for (const raw of paths) {
        const norm = normalizeArchiveFolderPath(raw);
        if (!norm) continue;
        const parts = norm.split("/");
        for (let i = 1; i <= parts.length; i += 1) {
          const sub = parts.slice(0, i).join("/");
          if (!folders.has(sub)) {
            folders.set(sub, {
              path: sub,
              display_name: parts[i - 1]!,
              description: "",
              sort_order: 0,
              created_at: "2026-11-25",
              updated_at: "2026-11-25",
            });
          }
        }
      }
    }),
    getArchiveFile: vi.fn(async (id: string) => files.get(id) ?? null),
    getArchiveFileByRelativePath: vi.fn(async (rel: string) => {
      for (const f of files.values()) {
        if (f.relative_path === rel) return f;
      }
      return null;
    }),
    getArchiveFileInlineBytes: vi.fn(async (id: string) => inlineMap.get(id) ?? null),
    createArchiveFile: vi.fn(async (file: ArchiveFile, inlineBytes: Uint8Array | null) => {
      if (file.folder_path) await store.ensureArchiveFolders([file.folder_path]);
      const saved: ArchiveFile = { ...file, id: file.id || randomUUID(), created_at: "2026-11-25", updated_at: "2026-11-25" };
      files.set(saved.id, saved);
      inlineMap.set(saved.id, inlineBytes);
      return saved;
    }),
    createIngestJob: vi.fn(async (job: IngestJob) => {
      job.id = randomUUID();
      jobs.set(job.id, { ...job });
    }),
    getIngestJob: vi.fn(async (id: string) => jobs.get(id) ?? null),
    getJobEventsMaxCount: vi.fn().mockResolvedValue(200),
    insertIngestJobEvent: vi.fn().mockResolvedValue(undefined),
    getDocumentByRelativePath: vi.fn(async (rel: string) => {
      for (const d of docs.values()) {
        if (d.relative_path === rel) return d;
      }
      return null;
    }),
    getDocument: vi.fn(async (id: string) => docs.get(id) ?? null),
    listDocumentsFiltered: vi.fn(async () => [...docs.values()]),
    listReferenceEntries: vi.fn(async () => []),
    getBacklinks: vi.fn(async () => []),
    getForwardReferences: vi.fn(async () => []),
    applyChangeSet: vi.fn(async (cs: ChangeSet, writes: Array<{ relative_path: string; document: Document | null }>) => {
      cs.id = randomUUID();
      changeSets.set(cs.id, cs);
      for (const w of writes) {
        if (w.document) {
          w.document.id = w.document.id || randomUUID();
          docs.set(w.document.id, w.document);
        }
      }
    }),
    replaceReferenceEntriesInTx: vi.fn().mockResolvedValue(undefined),
    replaceReferencesInTx: vi.fn().mockResolvedValue(undefined),
    linkDocumentArchiveSource: vi.fn(
      async (documentId: string, archiveFileId: string, changeSetId = "", relation = "ingest_source") => {
        docArchiveLinks.push({ documentId, archiveFileId, changeSetId, relation });
      },
    ),
    listDocumentArchiveSources: vi.fn(async (documentId: string): Promise<ArchiveSourceSummary[]> => {
      return docArchiveLinks
        .filter((l) => l.documentId === documentId)
        .map((l) => {
          const af = files.get(l.archiveFileId)!;
          return {
            id: af.id,
            filename: af.filename,
            folder_path: af.folder_path,
            relative_path: af.relative_path,
            kind: af.kind,
            media_type: af.media_type,
            size: af.size,
            origin: af.origin,
            relation: l.relation,
            created_at: af.created_at,
          };
        });
    }),
    listArchiveFileDocuments: vi.fn(async (archiveFileId: string) =>
      docArchiveLinks
        .filter((l) => l.archiveFileId === archiveFileId)
        .map((l) => {
          const d = docs.get(l.documentId)!;
          return {
            document_id: d.id,
            title: d.title,
            relative_path: d.relative_path,
            page_type: d.page_type ?? "",
            relation: l.relation,
            created_at: "2026-11-25",
          };
        }),
    ),
  } as unknown as Store;

  return { store, folders, files, jobs, docs, changeSets, docArchiveLinks };
}

describe("Ingest auto-archiving & Wiki bidirectional links", () => {
  const tmpDirs: string[] = [];

  afterEach(async () => {
    for (const d of tmpDirs) await rm(d, { recursive: true, force: true });
    tmpDirs.length = 0;
  });

  it("archives text and upload ingest sources automatically, deduplicates names, and links wiki documents", async () => {
    const ws = await mkdtemp(path.join(os.tmpdir(), "llmwiki-ingest-arch-"));
    tmpDirs.push(ws);
    const { store, files, docs, changeSets, docArchiveLinks } = createIngestArchiveMockStore();
    const app = createApp({
      db: store,
      token: "",
      publicWiki: false,
      noMcp: true,
      mcpAllowWrite: false,
      workspace: ws,
      webRoot: "/tmp/nonexistent-web",
      skillsRoot: "/tmp/nonexistent-skills",
    });

    // Text ingest with custom filename twice -> auto folder + deduplicated -2
    const t1 = await app.request("/api/v1/ingest/jobs/text", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: "note.md", content: "# Source Note\nDetails here." }),
    });
    expect(t1.status).toBe(201);
    const j1 = (await t1.json()) as { job: IngestJob; archive_file: ArchiveFile };
    expect(j1.job.archive_file_id).toBe(j1.archive_file.id);
    expect(j1.archive_file.folder_path).toMatch(/^ingest\/texts\/\d{4}-\d{2}$/);
    expect(j1.archive_file.filename).toBe("note.md");

    const t2 = await app.request("/api/v1/ingest/jobs/text", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: "note.md", content: "# Second" }),
    });
    expect(t2.status).toBe(201);
    const j2 = (await t2.json()) as { job: IngestJob; archive_file: ArchiveFile };
    expect(j2.archive_file.filename).toBe("note-2.md");

    // Job source preview reads from archive_file_id
    const srcRes = await app.request(`/api/v1/ingest/jobs/${j1.job.id}/source`);
    expect(srcRes.status).toBe(200);
    const srcBody = (await srcRes.json()) as { content: string; archive_file_id: string };
    expect(srcBody.content).toContain("# Source Note");
    expect(srcBody.archive_file_id).toBe(j1.archive_file.id);

    // Apply wiki blocks with archiveFileId -> links document_archive_sources
    const blocks = new Map<string, string>([
      ["wiki/concepts/source-note.md", "---\ntitle: Source Note\ndate: 2026-11-25\ntype: concept\n---\n\nBody"],
    ]);
    const { changeSetId } = await applyBlocksToStore(
      ws,
      blocks,
      { force: true },
      {
        db: store,
        changeSetKind: "ingest",
        changeSetJobId: j1.job.id,
        changeSetReviewId: "",
        archiveFileId: j1.archive_file.id,
        sourceFilename: j1.archive_file.filename,
        normalizedContent: "# Source Note",
        recorder: null,
      },
    );
    expect(changeSets.get(changeSetId)?.archive_file_id).toBe(j1.archive_file.id);
    expect(docArchiveLinks).toHaveLength(1);
    const createdDoc = [...docs.values()][0]!;

    // GET /api/v1/documents/:id returns archive_sources
    const docRes = await app.request(`/api/v1/documents/${createdDoc.id}`);
    expect(docRes.status).toBe(200);
    const docJson = (await docRes.json()) as { archive_sources: ArchiveSourceSummary[] };
    expect(docJson.archive_sources).toHaveLength(1);
    expect(docJson.archive_sources[0]!.id).toBe(j1.archive_file.id);

    // GET /api/v1/archives/files/:id returns wiki_documents
    const archRes = await app.request(`/api/v1/archives/files/${j1.archive_file.id}`);
    expect(archRes.status).toBe(200);
    const archJson = (await archRes.json()) as { wiki_documents: Array<{ document_id: string }> };
    expect(archJson.wiki_documents).toHaveLength(1);
    expect(archJson.wiki_documents[0]!.document_id).toBe(createdDoc.id);
    expect(files.size).toBe(2);
    expect(buildArchiveRelativePath(j1.archive_file.folder_path, "note.md")).toBe(j1.archive_file.relative_path);
  });
});
