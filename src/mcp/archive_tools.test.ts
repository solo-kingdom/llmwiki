import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Store } from "../store/interfaces.js";
import { buildArchiveRelativePath, normalizeArchiveFolderPath } from "../store/postgres/archives.js";
import type { ArchiveFile, ArchiveFolder, Document, FolderDeleteMode, IngestJob } from "../store/types.js";
import { defaultToolPolicy } from "./policy.js";
import { McpServer } from "./server.js";
import { registerTools } from "./tools.js";

function createMcpTestStore() {
  const config = new Map<string, string>([["archive_inline_max_bytes", "32"]]);
  const folders = new Map<string, ArchiveFolder>();
  const files = new Map<string, ArchiveFile>();
  const inlineMap = new Map<string, Uint8Array | null>();
  const docs = new Map<string, Document>();
  const links: Array<{ documentId: string; archiveFileId: string }> = [];
  const jobs = new Map<string, IngestJob>();

  const store = {
    getAllConfig: vi.fn(async () => Object.fromEntries(config.entries())),
    getConfig: vi.fn(async (k: string) => config.get(k) ?? ""),
    listArchiveFolders: vi.fn(async () =>
      [...folders.values()].map((f) => ({ ...f, direct_count: 0, total_count: 0 })),
    ),
    ensureArchiveFolders: vi.fn(async (paths: string[]) => {
      for (const raw of paths) {
        const norm = normalizeArchiveFolderPath(raw);
        if (!norm) continue;
        if (!folders.has(norm)) {
          folders.set(norm, {
            path: norm,
            display_name: norm,
            description: "",
            sort_order: 0,
            created_at: "2026-11-25",
            updated_at: "2026-11-25",
          });
        }
      }
    }),
    createArchiveFolder: vi.fn(async (input: { path: string; display_name?: string; description?: string }) => {
      const norm = normalizeArchiveFolderPath(input.path);
      const folder: ArchiveFolder = {
        path: norm,
        display_name: input.display_name || norm,
        description: input.description || "",
        sort_order: 0,
        created_at: "2026-11-25",
        updated_at: "2026-11-25",
      };
      folders.set(norm, folder);
      return folder;
    }),
    moveArchiveFolder: vi.fn(async (fromPath: string, toPath: string) => ({
      from_path: fromPath,
      to_path: toPath,
      moved_folders: 1,
      moved_files: 0,
    })),
    deleteArchiveFolder: vi.fn(async (p: string, mode: FolderDeleteMode) => {
      folders.delete(normalizeArchiveFolderPath(p));
      return {
        path: p,
        mode,
        deleted_folders: 1,
        moved_files: 0,
        deleted_files: 0,
        removed_storage_refs: [],
      };
    }),
    listArchiveFiles: vi.fn(async () => [...files.values()]),
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
    updateArchiveFileLocation: vi.fn(async (id: string, folderPath: string, filename: string) => {
      const f = files.get(id)!;
      f.folder_path = normalizeArchiveFolderPath(folderPath);
      f.filename = filename;
      f.relative_path = buildArchiveRelativePath(f.folder_path, filename);
      return f;
    }),
    deleteArchiveFile: vi.fn(async (id: string) => {
      const f = files.get(id) ?? null;
      files.delete(id);
      inlineMap.delete(id);
      return f;
    }),
    listArchiveFileDocuments: vi.fn(async () => []),
    getDocument: vi.fn(async (id: string) => docs.get(id) ?? null),
    linkDocumentArchiveSource: vi.fn(async (documentId: string, archiveFileId: string) => {
      links.push({ documentId, archiveFileId });
    }),
    unlinkDocumentArchiveSource: vi.fn(async (documentId: string, archiveFileId: string) => {
      const idx = links.findIndex((l) => l.documentId === documentId && l.archiveFileId === archiveFileId);
      if (idx < 0) return false;
      links.splice(idx, 1);
      return true;
    }),
    createIngestJob: vi.fn(async (job: IngestJob) => {
      job.id = randomUUID();
      jobs.set(job.id, { ...job });
    }),
    getJobEventsMaxCount: vi.fn().mockResolvedValue(200),
    insertIngestJobEvent: vi.fn().mockResolvedValue(undefined),
    createActivityLog: vi.fn().mockResolvedValue(undefined),
  } as unknown as Store;

  return { store, files, docs, links, jobs };
}

describe("MCP Archive Tools", () => {
  const tmpDirs: string[] = [];

  afterEach(async () => {
    for (const dir of tmpDirs) await rm(dir, { recursive: true, force: true });
    tmpDirs.length = 0;
  });

  async function rpc(server: McpServer, method: string, params?: unknown) {
    return server.handleRequest({ jsonrpc: "2.0", id: 1, method, params });
  }

  it("exposes only readonly archive tools when allowWrite=false and blocks write tools", async () => {
    const ws = await mkdtemp(path.join(os.tmpdir(), "llmwiki-mcp-ro-"));
    tmpDirs.push(ws);
    const { store } = createMcpTestStore();
    const server = new McpServer("LLM Wiki", "");
    registerTools(server, ws, store, null);
    server.setToolPolicy(defaultToolPolicy(false));

    const listRes = await rpc(server, "tools/list");
    const tools = ((listRes?.result as { tools: Array<{ name: string }> })?.tools ?? []).map((t) => t.name);
    expect(tools).toContain("archive_list");
    expect(tools).toContain("archive_read");
    expect(tools).not.toContain("archive_upload");
    expect(tools).not.toContain("archive_mkdir");
    expect(tools).not.toContain("archive_link");
    expect(tools).not.toContain("archive_ingest");

    const blocked = await rpc(server, "tools/call", {
      name: "archive_upload",
      arguments: { filename: "x.md", content: "hi" },
    });
    expect(blocked?.error).toBeDefined();
  });

  it("supports full archive_mkdir -> archive_upload -> archive_list -> archive_read -> archive_move -> archive_delete when allowWrite=true", async () => {
    const ws = await mkdtemp(path.join(os.tmpdir(), "llmwiki-mcp-rw-"));
    tmpDirs.push(ws);
    const { store, files, docs, links, jobs } = createMcpTestStore();
    docs.set("doc-1", {
      id: "doc-1",
      user_id: "default",
      filename: "p.md",
      title: "Page",
      path: "/wiki/concepts/",
      relative_path: "wiki/concepts/p.md",
      source_kind: "wiki",
      file_type: "md",
      file_size: 4,
      document_number: 1,
      status: "ready",
      page_count: 1,
      content: "body",
      tags: [],
      date: "",
      metadata: "",
      error_message: "",
      version: 1,
      parser: "",
      content_hash: "",
      stale_since: "",
      highlights: "[]",
      created_at: "",
      updated_at: "",
    });
    const server = new McpServer("LLM Wiki", "");
    registerTools(server, ws, store, null);
    server.setToolPolicy(defaultToolPolicy(true));

    await rpc(server, "tools/call", { name: "archive_mkdir", arguments: { path: "specs" } });
    const upRes = await rpc(server, "tools/call", {
      name: "archive_upload",
      arguments: { folder_path: "specs", filename: "design.md", content: "# Hello Archive" },
    });
    expect(upRes?.error).toBeUndefined();
    const uploaded = [...files.values()][0]!;
    expect(uploaded.relative_path).toBe("specs/design.md");

    const listRes = await rpc(server, "tools/call", { name: "archive_list", arguments: {} });
    const listText = (listRes?.result as { content: Array<{ text: string }> }).content[0]!.text;
    expect(listText).toContain("specs/design.md");

    const readRes = await rpc(server, "tools/call", {
      name: "archive_read",
      arguments: { path: "specs/design.md" },
    });
    const readText = (readRes?.result as { content: Array<{ text: string }> }).content[0]!.text;
    expect(readText).toContain("# Hello Archive");

    await rpc(server, "tools/call", {
      name: "archive_move",
      arguments: { target_type: "file", id: uploaded.id, new_filename: "design-v2.md" },
    });
    expect(uploaded.relative_path).toBe("specs/design-v2.md");

    // archive_link & archive_ingest
    const linkRes = await rpc(server, "tools/call", {
      name: "archive_link",
      arguments: { action: "link", document_id: "doc-1", path: "specs/design-v2.md" },
    });
    expect(linkRes?.error).toBeUndefined();
    expect(links).toHaveLength(1);

    const ingestRes = await rpc(server, "tools/call", {
      name: "archive_ingest",
      arguments: { id: uploaded.id },
    });
    expect(ingestRes?.error).toBeUndefined();
    expect(jobs.size).toBe(1);

    await rpc(server, "tools/call", {
      name: "archive_link",
      arguments: { action: "unlink", document_id: "doc-1", archive_file_id: uploaded.id },
    });
    expect(links).toHaveLength(0);

    await rpc(server, "tools/call", {
      name: "archive_delete",
      arguments: { target_type: "file", id: uploaded.id },
    });
    expect(files.size).toBe(0);
  });
});
