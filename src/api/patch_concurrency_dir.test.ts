import { createHash } from "node:crypto";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { defaultToolPolicy } from "../mcp/policy.js";
import { McpServer } from "../mcp/server.js";
import { registerTools } from "../mcp/tools.js";
import { createApp } from "../server/app.js";
import type { Store } from "../store/interfaces.js";
import { ArchiveConflictError } from "../store/postgres/archives.js";
import { FolderConflictError } from "../store/postgres/folders.js";
import type { ArchiveFile, Document } from "../store/types.js";

function sha256(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

function makeTestEnv() {
  const initialWikiContent = [
    "---",
    "title: Agent API",
    "type: concept",
    "date: 2026-11-28",
    "---",
    "",
    "# 概述",
    "第一段内容",
    "第二段内容",
  ].join("\n");

  const docs = new Map<string, Document>([
    [
      "doc-1",
      {
        id: "doc-1",
        user_id: "default",
        filename: "agent-api.md",
        title: "Agent API",
        path: "/wiki/dev/",
        relative_path: "wiki/dev/agent-api.md",
        source_kind: "wiki",
        file_type: "md",
        file_size: initialWikiContent.length,
        document_number: 1,
        status: "ready",
        page_count: 1,
        content: initialWikiContent,
        tags: ["api"],
        date: "2026-11-28",
        metadata: "{}",
        error_message: "",
        version: 3,
        parser: "",
        content_hash: sha256(initialWikiContent),
        stale_since: "",
        highlights: "[]",
        created_at: "",
        updated_at: "",
        page_type: "concept",
      },
    ],
  ]);

  let archiveBytes = Buffer.from("line A\nline B\nline C", "utf8");
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
        size: archiveBytes.length,
        sha256: createHash("sha256").update(archiveBytes).digest("hex"),
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
      "af-bin",
      {
        id: "af-bin",
        folder_path: "specs",
        filename: "img.png",
        title: "Img",
        relative_path: "specs/img.png",
        media_type: "image/png",
        kind: "image",
        size: 4,
        sha256: "binsha",
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

  const moveFolder = vi.fn(
    async (fromPath: string, toPath: string, _actor?: string, opts?: { onConflict?: "fail" | "merge" }) => {
      if (opts?.onConflict !== "merge" && toPath === "existing") {
        throw new FolderConflictError("target folder already exists: existing");
      }
      if (opts?.onConflict === "merge" && fromPath === "conflict-src") {
        throw new FolderConflictError("target folder merge conflict", ["wiki/existing/dup.md"]);
      }
      return {
        from_path: fromPath,
        to_path: toPath,
        moved_folders: 1,
        moved_documents: 1,
        moved_doc_paths: [`wiki/${toPath}/agent-api.md`],
        change_set_id: "cs-fmove",
        updated_link_paths: [],
      };
    },
  );

  const moveArchiveFolder = vi.fn(
    async (fromPath: string, toPath: string, opts?: { onConflict?: "fail" | "merge" }) => {
      if (opts?.onConflict !== "merge" && toPath === "existing") {
        throw new ArchiveConflictError("target folder already exists: existing");
      }
      if (opts?.onConflict === "merge" && fromPath === "conflict-src") {
        throw new ArchiveConflictError("target folder merge conflict", ["existing/dup.md"]);
      }
      return {
        from_path: fromPath,
        to_path: toPath,
        moved_folders: 1,
        moved_files: 1,
      };
    },
  );

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
    findDocumentByName: vi.fn(async () => null),
    listDocumentsFiltered: vi.fn(async () => [...docs.values()]),
    listReferenceEntries: vi.fn().mockResolvedValue([]),
    replaceReferenceEntriesInTx: vi.fn().mockResolvedValue(undefined),
    replaceReferencesInTx: vi.fn().mockResolvedValue(undefined),
    listFolders: vi.fn().mockResolvedValue([]),
    applyChangeSet: vi.fn(async (_cs, writes) => {
      for (const w of writes) {
        if (w.document) {
          const prev = docs.get(w.document.id);
          const next = { ...w.document, version: (prev?.version ?? 0) + 1 };
          docs.set(next.id, next);
        }
      }
    }),
    moveFolder,
    moveArchiveFolder,
    getArchiveFile: vi.fn(async (id: string) => archiveFiles.get(id) ?? null),
    getArchiveFileByRelativePath: vi.fn(async (rel: string) => {
      for (const f of archiveFiles.values()) if (f.relative_path === rel) return f;
      return null;
    }),
    getArchiveFileInlineBytes: vi.fn(async (id: string) => (id === "af-1" ? new Uint8Array(archiveBytes) : null)),
    updateArchiveFileContentMeta: vi.fn(async (id: string, patch) => {
      const f = archiveFiles.get(id)!;
      if (patch.inline_bytes) archiveBytes = Buffer.from(patch.inline_bytes);
      const updated: ArchiveFile = {
        ...f,
        size: patch.size,
        sha256: patch.sha256,
        storage_backend: patch.storage_backend,
        storage_key: patch.storage_key,
      };
      archiveFiles.set(id, updated);
      return updated;
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

  return { app, store, docs, archiveFiles, moveFolder, moveArchiveFolder };
}

describe("s2 patch, optimistic locking & folder merge", () => {
  it("supports Wiki PATCH /content with dry_run, optimistic lock 409, and If-Match", async () => {
    const { app, docs } = makeTestEnv();

    const dryRes = await app.request("/api/v1/documents/doc-1/content", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        edits: [{ op: "replace", old_text: "第一段内容", new_text: "第一段（已修）" }],
        expected_version: 3,
        dry_run: true,
      }),
    });
    expect(dryRes.status).toBe(200);
    const dryBody = (await dryRes.json()) as { dry_run: boolean; preview_content: string };
    expect(dryBody.dry_run).toBe(true);
    expect(dryBody.preview_content).toContain("第一段（已修）");
    expect(docs.get("doc-1")!.version).toBe(3);

    const conflictRes = await app.request("/api/v1/documents/doc-1/content", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "If-Match": '"99"' },
      body: JSON.stringify({
        edits: [{ op: "append", text: "tail" }],
      }),
    });
    expect(conflictRes.status).toBe(409);
    const conflictBody = (await conflictRes.json()) as { code: string; current_version: number };
    expect(conflictBody.code).toBe("VERSION_CONFLICT");
    expect(conflictBody.current_version).toBe(3);

    const notFoundEdit = await app.request("/api/v1/documents/doc-1/content", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        edits: [{ op: "replace", old_text: "不存在文本", new_text: "x" }],
      }),
    });
    expect(notFoundEdit.status).toBe(422);

    const applyRes = await app.request("/api/v1/documents/doc-1/content", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        edits: [{ op: "replace", old_text: "第一段内容", new_text: "第一段（已修）" }],
        expected_version: 3,
      }),
    });
    expect(applyRes.status).toBe(200);
    expect(docs.get("doc-1")!.version).toBe(4);
    expect(docs.get("doc-1")!.content).toContain("第一段（已修）");
  });

  it("enforces optimistic lock across PUT /content, PATCH /:id, archive, and reopen", async () => {
    const { app } = makeTestEnv();

    for (const [method, url, body] of [
      ["PUT", "/api/v1/documents/doc-1/content", { content: "x", expected_version: 999 }],
      ["PATCH", "/api/v1/documents/doc-1", { title: "New", expected_version: 999 }],
      ["POST", "/api/v1/documents/doc-1/archive", { reason: "old", expected_version: 999 }],
      ["POST", "/api/v1/documents/doc-1/reopen", { reason: "reopen", expected_version: 999 }],
    ] as const) {
      const res = await app.request(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(409);
    }
  });

  it("supports Archive PATCH /content, rejects non-text files, and checks expected_sha256", async () => {
    const { app, archiveFiles } = makeTestEnv();
    const origSha = archiveFiles.get("af-1")!.sha256;

    const binRes = await app.request("/api/v1/archives/files/af-bin/content", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ edits: [{ op: "append", text: "x" }] }),
    });
    expect(binRes.status).toBe(400);

    const conflictRes = await app.request("/api/v1/archives/files/af-1/content", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        edits: [{ op: "append", text: "line D" }],
        expected_sha256: "wrong-sha",
      }),
    });
    expect(conflictRes.status).toBe(409);

    const okRes = await app.request("/api/v1/archives/files/af-1/content", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        edits: [{ op: "replace", old_text: "line B", new_text: "line B2" }],
        expected_sha256: origSha,
      }),
    });
    expect(okRes.status).toBe(200);
    const body = (await okRes.json()) as { file: ArchiveFile; applied_edits: number };
    expect(body.applied_edits).toBe(1);
    expect(body.file.sha256).not.toBe(origSha);
  });

  it("supports on_conflict=merge on wiki and archive folder moves and surfaces conflicts[]", async () => {
    const { app, moveFolder, moveArchiveFolder } = makeTestEnv();

    const badWiki = await app.request("/api/v1/folders/move", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from_path: "dev", to_path: "existing", on_conflict: "overwrite" }),
    });
    expect(badWiki.status).toBe(400);

    const okWiki = await app.request("/api/v1/folders/move", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from_path: "dev", to_path: "existing", on_conflict: "merge" }),
    });
    expect(okWiki.status).toBe(200);
    expect(moveFolder).toHaveBeenCalledWith("dev", "existing", "api", { onConflict: "merge" });

    const conflictWiki = await app.request("/api/v1/folders/move", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from_path: "conflict-src", to_path: "existing", on_conflict: "merge" }),
    });
    expect(conflictWiki.status).toBe(409);
    const cBody = (await conflictWiki.json()) as { conflicts?: string[] };
    expect(cBody.conflicts).toEqual(["wiki/existing/dup.md"]);

    const okArchive = await app.request("/api/v1/archives/folders/move", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from_path: "specs", to_path: "existing", on_conflict: "merge" }),
    });
    expect(okArchive.status).toBe(200);
    expect(moveArchiveFolder).toHaveBeenCalledWith("specs", "existing", { onConflict: "merge" });
  });

  it("supports MCP write(patch/append), archive_patch, and readonly policy blocking archive_patch", async () => {
    const { store, docs } = makeTestEnv();
    const server = new McpServer("LLM Wiki", "");
    registerTools(server, "", store);
    server.setToolPolicy(defaultToolPolicy(false));

    const roRes = await server.handleRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "archive_patch", arguments: { id: "af-1", edits: [{ op: "append", text: "x" }] } },
    });
    expect(roRes?.error?.message).toContain("disabled by policy");

    server.setToolPolicy(defaultToolPolicy(true));
    const patchRes = await server.handleRequest({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "write",
        arguments: {
          id: "doc-1",
          mode: "patch",
          edits: [{ op: "replace", old_text: "第二段内容", new_text: "第二段（MCP）" }],
          expected_version: 3,
        },
      },
    });
    const patchText = (patchRes?.result as { content: Array<{ text: string }> }).content[0]!.text;
    expect(patchText).toContain("Patched:");
    expect(docs.get("doc-1")!.content).toContain("第二段（MCP）");

    const archPatchRes = await server.handleRequest({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "archive_patch",
        arguments: {
          path: "specs/spec.md",
          edits: [{ op: "append", text: "line D" }],
        },
      },
    });
    const archText = (archPatchRes?.result as { content: Array<{ text: string }> }).content[0]!.text;
    expect(archText).toContain("Patched archive");
  });
});
