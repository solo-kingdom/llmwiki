import { randomUUID } from "node:crypto";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { rebuildDerived } from "../ingest/rebuild.js";
import { executeLocalAudit, executeLocalGaps, executeLocalStructure } from "../mcp/diagnostic_tools.js";
import { createApp } from "../server/app.js";
import type { Store } from "../store/interfaces.js";
import type { ArchiveFile, Document, IngestSession, IngestSessionMessage } from "../store/types.js";

function makeInMemoryStore() {
  const config = new Map<string, string>();
  const docs = new Map<string, Document>();
  const sessions = new Map<string, IngestSession>();
  const messages: IngestSessionMessage[] = [];
  const archives = new Map<string, ArchiveFile>();
  const archiveBytes = new Map<string, Uint8Array>();

  const store = {
    getConfig: vi.fn(async (key: string) => config.get(key) ?? ""),
    setConfig: vi.fn(async (key: string, value: string) => {
      config.set(key, value);
    }),
    getAllConfig: vi.fn(async () => Object.fromEntries(config.entries())),
    getWorkspace: vi.fn().mockResolvedValue(null),
    listDocumentsFiltered: vi.fn(async () => [...docs.values()]),
    listDocumentsWithContent: vi.fn(async () => [...docs.values()]),
    listDocuments: vi.fn(async () => [...docs.values()]),
    listFolders: vi.fn(async () => []),
    getDocumentByRelativePath: vi.fn(async (rel: string) => {
      for (const d of docs.values()) {
        if (d.relative_path === rel) return d;
      }
      return null;
    }),
    storeChunks: vi.fn().mockResolvedValue(undefined),
    listReferenceEntries: vi.fn().mockResolvedValue([]),
    replaceReferencesInTx: vi.fn().mockResolvedValue(undefined),
    applyChangeSet: vi.fn(async (_cs, writes) => {
      for (const w of writes) {
        if (w.operation === "delete") docs.delete(w.relative_path);
        else if (w.document) docs.set(w.relative_path, w.document);
      }
    }),
    createActivityLog: vi.fn().mockResolvedValue(undefined),
    countActivityLogs: vi.fn().mockResolvedValue(0),
    trimActivityLogs: vi.fn().mockResolvedValue(0),
    trimAllIngestJobEvents: vi.fn().mockResolvedValue(undefined),
    countIngestSessions: vi.fn(async () => sessions.size),
    createIngestSession: vi.fn(async (session: IngestSession) => {
      const id = session.id || randomUUID();
      session.id = id;
      sessions.set(id, { ...session });
    }),
    getIngestSession: vi.fn(async (id: string) => sessions.get(id) ?? null),
    updateIngestSessionTitle: vi.fn(async (id: string, title: string) => {
      const s = sessions.get(id);
      if (s) s.title = title;
    }),
    createIngestSessionMessage: vi.fn(async (msg: IngestSessionMessage) => {
      msg.id = msg.id || randomUUID();
      messages.push({ ...msg });
    }),
    listArchiveFiles: vi.fn(async () => [...archives.values()]),
    getArchiveFileByRelativePath: vi.fn(async (rel: string) => {
      for (const f of archives.values()) {
        if (f.relative_path === rel) return f;
      }
      return null;
    }),
    createArchiveFile: vi.fn(async (file: ArchiveFile, inlineBytes: Uint8Array | null) => {
      archives.set(file.id, { ...file });
      if (inlineBytes) archiveBytes.set(file.id, inlineBytes);
      return { ...file };
    }),
    getArchiveFile: vi.fn(async (id: string) => archives.get(id) ?? null),
    getBacklinks: vi.fn().mockResolvedValue([]),
  } as unknown as Store;

  return { store, config, docs, archives };
}

describe("DB-native stateless smoke (no workspace dir)", () => {
  it("handles workspace overview, full >500-char rules, legacy settings, sessions & attachments without 503", async () => {
    const { store, archives } = makeInMemoryStore();
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

    const ws1 = await app.request("/api/v1/workspace");
    expect(ws1.status).toBe(200);
    const wsJson1 = (await ws1.json()) as { layout: { purpose: boolean; rules: boolean; index_db: boolean } };
    expect(wsJson1.layout.purpose).toBe(false);
    expect(wsJson1.layout.rules).toBe(false);
    expect(wsJson1.layout.index_db).toBe(true);

    const longPurpose = "P".repeat(1250);
    const longRules = "R".repeat(1400);
    const putRules = await app.request("/api/v1/workspace/rule-files", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ purpose: longPurpose, rules: longRules }),
    });
    expect(putRules.status).toBe(200);

    const getRules = await app.request("/api/v1/workspace/rule-files");
    expect(getRules.status).toBe(200);
    const rulesJson = (await getRules.json()) as Record<string, string>;
    expect(rulesJson.purpose).toBe(longPurpose);
    expect(rulesJson.rules).toBe(longRules);
    expect(rulesJson.purpose_preview).toBe(longPurpose);
    expect(rulesJson.rules_preview).toBe(longRules);

    const ws2 = await app.request("/api/v1/workspace");
    const wsJson2 = (await ws2.json()) as { layout: { purpose: boolean; rules: boolean } };
    expect(wsJson2.layout.purpose).toBe(true);
    expect(wsJson2.layout.rules).toBe(true);

    const putSettings = await app.request("/api/v1/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ auto_reindex: true, watch_sources: true, chunk_size: 640 }),
    });
    expect(putSettings.status).toBe(200);
    const settingsJson = (await putSettings.json()) as Record<string, unknown>;
    expect(settingsJson).not.toHaveProperty("auto_reindex");
    expect(settingsJson).not.toHaveProperty("watch_sources");
    expect(settingsJson.chunk_size).toBe("640");

    const createSess = await app.request("/api/v1/ingest/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "DB Native Session" }),
    });
    expect(createSess.status).toBe(201);
    const sessJson = (await createSess.json()) as { session: { id: string } };

    const form = new FormData();
    form.append("file", new File(["hello archive"], "notes.txt", { type: "text/plain" }));
    const uploadRes = await app.request(`/api/v1/ingest/sessions/${sessJson.session.id}/attachments`, {
      method: "POST",
      body: form,
    });
    expect(uploadRes.status).toBe(201);
    const uploadJson = (await uploadRes.json()) as { attachment_id: string; path: string };
    expect(archives.has(uploadJson.attachment_id)).toBe(true);
    expect(uploadJson.path).toContain(`ingest/sessions/${sessJson.session.id}/attachments/notes.txt`);
  });

  it("runs MCP diagnostics and rebuildDerived cleanly without workspace dir or wiki/index.md", async () => {
    const { store, docs } = makeInMemoryStore();
    docs.set("wiki/products/llmwiki/note.md", {
      id: "doc-1",
      user_id: "default",
      filename: "note.md",
      title: "Note",
      path: "/wiki/products/llmwiki/",
      relative_path: "wiki/products/llmwiki/note.md",
      source_kind: "wiki",
      file_type: "md",
      file_size: 120,
      document_number: 1,
      status: "ready",
      page_count: 1,
      content: "---\ntitle: Note\ntype: entity\ndate: 2026-11-27\nconfidence: medium\nsources: []\n---\n\nBody text.",
      tags: ["llmwiki"],
      date: "2026-11-27",
      metadata: "{}",
      error_message: "",
      version: 1,
      parser: "",
      content_hash: "",
      stale_since: "",
      highlights: "[]",
      created_at: "",
      updated_at: "2026-11-27",
      page_type: "entity",
    });

    const auditOut = await executeLocalAudit("", store, {});
    expect(auditOut).not.toContain("索引幽灵页");
    expect(auditOut).toContain("Lint 检查");

    const structOut = await executeLocalStructure("", store);
    expect(structOut).toContain("PostgreSQL（SSOT）");
    expect(structOut).not.toContain("workspace not configured");
    expect(structOut).not.toContain("templates/");

    const gapsOut = await executeLocalGaps("", store, {});
    expect(gapsOut).toContain("缺失页面");

    await rebuildDerived(store);
    expect(docs.has("wiki/index.md")).toBe(false);
  });
});
