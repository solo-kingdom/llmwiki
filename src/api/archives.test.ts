import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../server/app.js";
import type { Store } from "../store/interfaces.js";
import {
  ArchiveConflictError,
  ArchiveNotFoundError,
  buildArchiveRelativePath,
  normalizeArchiveFolderPath,
  validateArchiveFilename,
} from "../store/postgres/archives.js";
import type { ApiKeyRecord, ArchiveFile, ArchiveFolder, FolderDeleteMode } from "../store/types.js";

function makeInMemoryArchiveStore(initialConfig: Record<string, string> = {}) {
  const config = new Map<string, string>(Object.entries(initialConfig));
  const folders = new Map<string, ArchiveFolder>();
  const files = new Map<string, ArchiveFile>();
  const inlineMap = new Map<string, Uint8Array | null>();
  const keys = new Map<string, ApiKeyRecord & { key_hash: string }>();

  const store = {
    getConfig: vi.fn(async (key: string) => config.get(key) ?? ""),
    setConfig: vi.fn(async (key: string, value: string) => {
      config.set(key, value);
    }),
    getAllConfig: vi.fn(async () => Object.fromEntries(config.entries())),
    countActivityLogs: vi.fn().mockResolvedValue(0),
    createActivityLog: vi.fn().mockResolvedValue(undefined),
    findApiKeyByHash: vi.fn(async (hash: string) => {
      for (const k of keys.values()) {
        if (k.key_hash === hash) return k;
      }
      return null;
    }),
    touchApiKey: vi.fn().mockResolvedValue(undefined),

    listArchiveFolders: vi.fn(async () =>
      [...folders.values()].map((f) => ({
        ...f,
        direct_count: [...files.values()].filter((file) => file.folder_path === f.path).length,
        total_count: [...files.values()].filter(
          (file) => file.folder_path === f.path || file.folder_path.startsWith(`${f.path}/`),
        ).length,
      })),
    ),
    getArchiveFolder: vi.fn(async (p: string) => folders.get(normalizeArchiveFolderPath(p)) ?? null),
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
              created_at: "2026-11-25 00:00:00",
              updated_at: "2026-11-25 00:00:00",
            });
          }
        }
      }
    }),
    createArchiveFolder: vi.fn(async (input: { path: string; display_name?: string; description?: string; sort_order?: number }) => {
      const norm = normalizeArchiveFolderPath(input.path);
      if (!norm) throw new Error("empty");
      if (folders.has(norm)) throw new ArchiveConflictError(`exists: ${norm}`);
      await store.ensureArchiveFolders([norm]);
      const folder: ArchiveFolder = {
        path: norm,
        display_name: input.display_name || path.posix.basename(norm),
        description: input.description || "",
        sort_order: input.sort_order ?? 0,
        created_at: "2026-11-25 00:00:00",
        updated_at: "2026-11-25 00:00:00",
      };
      folders.set(norm, folder);
      return folder;
    }),
    updateArchiveFolder: vi.fn(async (p: string, patch: { display_name?: string; description?: string; sort_order?: number }) => {
      const norm = normalizeArchiveFolderPath(p);
      const cur = folders.get(norm);
      if (!cur) return null;
      const next = { ...cur, ...patch };
      folders.set(norm, next);
      return next;
    }),
    moveArchiveFolder: vi.fn(async (fromPath: string, toPath: string) => {
      const from = normalizeArchiveFolderPath(fromPath);
      const to = normalizeArchiveFolderPath(toPath);
      if (!folders.has(from)) throw new ArchiveNotFoundError(`missing: ${from}`);
      if (folders.has(to)) throw new ArchiveConflictError(`exists: ${to}`);
      let movedFolders = 0;
      let movedFiles = 0;
      for (const [key, folder] of [...folders.entries()]) {
        if (key === from || key.startsWith(`${from}/`)) {
          const next = `${to}${key.slice(from.length)}`;
          folders.delete(key);
          folders.set(next, { ...folder, path: next });
          movedFolders += 1;
        }
      }
      for (const file of files.values()) {
        if (file.folder_path === from || file.folder_path.startsWith(`${from}/`)) {
          file.folder_path = `${to}${file.folder_path.slice(from.length)}`;
          file.relative_path = buildArchiveRelativePath(file.folder_path, file.filename);
          movedFiles += 1;
        }
      }
      return { from_path: from, to_path: to, moved_folders: movedFolders, moved_files: movedFiles };
    }),
    deleteArchiveFolder: vi.fn(async (p: string, mode: FolderDeleteMode) => {
      const norm = normalizeArchiveFolderPath(p);
      if (!folders.has(norm)) throw new ArchiveNotFoundError(`missing: ${norm}`);
      const sub = [...folders.keys()].filter((k) => k === norm || k.startsWith(`${norm}/`));
      const affected = [...files.values()].filter((f) => f.folder_path === norm || f.folder_path.startsWith(`${norm}/`));
      if (mode === "empty" && (sub.length > 1 || affected.length > 0)) {
        throw new ArchiveConflictError("not empty");
      }
      const removedRefs: Array<{ storage_backend: ArchiveFile["storage_backend"]; storage_key: string }> = [];
      let movedFiles = 0;
      let deletedFiles = 0;
      if (mode === "move_to_parent") {
        const parent = norm.includes("/") ? norm.slice(0, norm.lastIndexOf("/")) : "";
        for (const f of affected) {
          f.folder_path = parent;
          f.relative_path = buildArchiveRelativePath(parent, f.filename);
          movedFiles += 1;
        }
      } else if (mode === "cascade") {
        for (const f of affected) {
          if (f.storage_backend !== "db" && f.storage_key) {
            removedRefs.push({ storage_backend: f.storage_backend, storage_key: f.storage_key });
          }
          files.delete(f.id);
          inlineMap.delete(f.id);
          deletedFiles += 1;
        }
      }
      for (const k of sub) folders.delete(k);
      return {
        path: norm,
        mode,
        deleted_folders: sub.length,
        moved_files: movedFiles,
        deleted_files: deletedFiles,
        removed_storage_refs: removedRefs,
      };
    }),
    listArchiveFiles: vi.fn(async (filter: { kind?: string; q?: string } = {}) =>
      [...files.values()].filter((f) => {
        if (filter.kind && f.kind !== filter.kind) return false;
        if (filter.q && !f.relative_path.toLowerCase().includes(filter.q.toLowerCase())) return false;
        return true;
      }),
    ),
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
      const saved: ArchiveFile = {
        ...file,
        id: file.id || randomUUID(),
        created_at: "2026-11-25 00:00:00",
        updated_at: "2026-11-25 00:00:00",
      };
      files.set(saved.id, saved);
      inlineMap.set(saved.id, inlineBytes ? new Uint8Array(inlineBytes) : null);
      return saved;
    }),
    updateArchiveFileLocation: vi.fn(async (id: string, folderPath: string, filename: string) => {
      const cur = files.get(id);
      if (!cur) throw new ArchiveNotFoundError("not found");
      const normFolder = normalizeArchiveFolderPath(folderPath);
      const validFile = validateArchiveFilename(filename);
      if (normFolder) await store.ensureArchiveFolders([normFolder]);
      cur.folder_path = normFolder;
      cur.filename = validFile;
      cur.relative_path = buildArchiveRelativePath(normFolder, validFile);
      return cur;
    }),
    updateArchiveFileContentMeta: vi.fn(async (id: string, patch: {
      size: number;
      sha256: string;
      storage_backend: ArchiveFile["storage_backend"];
      storage_key: string;
      inline_bytes: Uint8Array | null;
    }) => {
      const cur = files.get(id);
      if (!cur) throw new ArchiveNotFoundError("not found");
      cur.size = patch.size;
      cur.sha256 = patch.sha256;
      cur.storage_backend = patch.storage_backend;
      cur.storage_key = patch.storage_key;
      inlineMap.set(id, patch.inline_bytes ? new Uint8Array(patch.inline_bytes) : null);
      return cur;
    }),
    deleteArchiveFile: vi.fn(async (id: string) => {
      const cur = files.get(id) ?? null;
      files.delete(id);
      inlineMap.delete(id);
      return cur;
    }),
    listArchiveFileDocuments: vi.fn(async () => []),
  } as unknown as Store;

  return { store, keys, config };
}

describe("Archives HTTP API & storage settings", () => {
  const tmpDirs: string[] = [];

  afterEach(async () => {
    for (const dir of tmpDirs) await rm(dir, { recursive: true, force: true });
    tmpDirs.length = 0;
  });

  async function makeTestApp(initialConfig: Record<string, string> = {}) {
    const ws = await mkdtemp(path.join(os.tmpdir(), "llmwiki-archive-api-"));
    tmpDirs.push(ws);
    const { store, keys, config } = makeInMemoryArchiveStore(initialConfig);
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
    return { app, ws, store, keys, config };
  }

  it("supports folder CRUD, multi-file upload, tiered auto-promotion, range 206, and HTML CSP sandbox", async () => {
    const { app } = await makeTestApp({ archive_inline_max_bytes: "16" });

    // Create folder
    const folderRes = await app.request("/api/v1/archives/folders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "media/demos", display_name: "Demos" }),
    });
    expect(folderRes.status).toBe(201);

    // Upload small HTML + large video
    const form = new FormData();
    form.append("folder_path", "media/demos");
    form.append("files", new File(["<h1>Hello</h1>"], "index.html", { type: "text/html" }));
    form.append("files", new File(["0123456789abcdefghij"], "demo.mp4", { type: "video/mp4" }));
    const uploadRes = await app.request("/api/v1/archives/files", { method: "POST", body: form });
    expect(uploadRes.status).toBe(201);
    const uploaded = (await uploadRes.json()) as { files: ArchiveFile[] };
    expect(uploaded.files).toHaveLength(2);
    const htmlFile = uploaded.files.find((f) => f.filename === "index.html")!;
    const videoFile = uploaded.files.find((f) => f.filename === "demo.mp4")!;
    expect(htmlFile.storage_backend).toBe("db");
    expect(videoFile.storage_backend).toBe("local");

    // HTML /raw returns CSP sandbox
    const htmlRaw = await app.request(`/api/v1/archives/files/${htmlFile.id}/raw`);
    expect(htmlRaw.status).toBe(200);
    expect(htmlRaw.headers.get("content-security-policy")).toContain("sandbox");

    // Video /raw returns 206 Partial Content
    const videoRange = await app.request(`/api/v1/archives/files/${videoFile.id}/raw`, {
      headers: { Range: "bytes=2-7" },
    });
    expect(videoRange.status).toBe(206);
    expect(videoRange.headers.get("content-range")).toBe("bytes 2-7/20");
    expect(await videoRange.text()).toBe("234567");

    // Edit small HTML past 16 bytes -> auto-promoted to local
    const editRes = await app.request(`/api/v1/archives/files/${htmlFile.id}/content`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "<html><body>This content is longer than 16 bytes</body></html>" }),
    });
    expect(editRes.status).toBe(200);
    const editBody = (await editRes.json()) as { file: ArchiveFile; promoted: boolean; previous_backend: string };
    expect(editBody.promoted).toBe(true);
    expect(editBody.previous_backend).toBe("db");
    expect(editBody.file.storage_backend).toBe("local");

    // Tree listing
    const treeRes = await app.request("/api/v1/archives/tree");
    expect(treeRes.status).toBe(200);
    const tree = (await treeRes.json()) as { folders: ArchiveFolder[]; files: ArchiveFile[] };
    expect(tree.folders.some((f) => f.path === "media/demos")).toBe(true);
    expect(tree.files).toHaveLength(2);
  });

  it("allows API keys to access archives while blocking S3 credential management", async () => {
    const { app, keys } = await makeTestApp();
    const rawKey = "llmwiki_sk_test_archive_key_123456";
    const keyHash = createHash("sha256").update(rawKey).digest("hex");
    keys.set("k1", {
      id: "k1",
      name: "test-agent",
      prefix: "llmwiki_sk_test",
      key_hash: keyHash,
      created_at: "2026-11-25 00:00:00",
      last_used_at: null,
    });

    const treeRes = await app.request("/api/v1/archives/tree", {
      headers: { Authorization: `Bearer ${rawKey}` },
    });
    expect(treeRes.status).toBe(200);

    const credRes = await app.request("/api/v1/settings", {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${rawKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ archive_s3_secret_access_key: "leaked" }),
    });
    expect(credRes.status).toBe(403);

    const checkRes = await app.request("/api/v1/settings/storage/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archive_storage_backend: "local" }),
    });
    expect(checkRes.status).toBe(200);
    const checkBody = (await checkRes.json()) as { ok: boolean; backend: string };
    expect(checkBody.ok).toBe(true);
    expect(checkBody.backend).toBe("local");
  });
});
