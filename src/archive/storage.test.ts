import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { afterEach, describe, expect, it } from "vitest";
import type { Store } from "../store/interfaces.js";
import {
  ArchiveConflictError,
  buildArchiveRelativePath,
  escapeLikePattern,
  extractSearchSnippet,
  normalizeArchiveFolderPath,
} from "../store/postgres/archives.js";
import type { ArchiveFile, ArchiveFolder } from "../store/types.js";
import {
  ArchiveStorageService,
  MAX_ARCHIVE_SEARCHABLE_BYTES,
  detectArchiveKind,
  extractArchiveSearchableText,
  ingestAutoFolder,
} from "./storage.js";

function createMemoryArchiveStore(initialConfig: Record<string, string> = {}) {
  const config = new Map<string, string>(Object.entries(initialConfig));
  const folders = new Map<string, ArchiveFolder>();
  const files = new Map<string, ArchiveFile>();
  const inlineMap = new Map<string, Uint8Array | null>();
  const searchTextMap = new Map<string, string | null>();

  const store = {
    getAllConfig: async () => Object.fromEntries(config.entries()),
    getConfig: async (key: string) => config.get(key) ?? "",
    setConfig: async (key: string, value: string) => {
      config.set(key, value);
    },
    ensureArchiveFolders: async (folderPaths: string[]) => {
      for (const fp of folderPaths) {
        const norm = normalizeArchiveFolderPath(fp);
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
    },
    getArchiveFile: async (id: string) => files.get(id) ?? null,
    getArchiveFileByRelativePath: async (rel: string) => {
      for (const f of files.values()) {
        if (f.relative_path === rel) return f;
      }
      return null;
    },
    getArchiveFileInlineBytes: async (id: string) => inlineMap.get(id) ?? null,
    createArchiveFile: async (file: ArchiveFile, inlineBytes: Uint8Array | null, searchableText = "") => {
      for (const f of files.values()) {
        if (f.relative_path === file.relative_path) {
          throw new ArchiveConflictError(`duplicate: ${file.relative_path}`);
        }
      }
      if (file.folder_path) await store.ensureArchiveFolders([file.folder_path]);
      const saved: ArchiveFile = {
        ...file,
        created_at: "2026-11-25 00:00:00",
        updated_at: "2026-11-25 00:00:00",
      };
      files.set(saved.id, saved);
      inlineMap.set(saved.id, inlineBytes ? new Uint8Array(inlineBytes) : null);
      searchTextMap.set(saved.id, searchableText);
      return saved;
    },
    updateArchiveFileContentMeta: async (
      id: string,
      patch: {
        size: number;
        sha256: string;
        storage_backend: "db" | "local" | "s3";
        storage_key: string;
        inline_bytes: Uint8Array | null;
        media_type?: string;
        kind?: ArchiveFile["kind"];
        searchable_text?: string;
      },
    ) => {
      const existing = files.get(id);
      if (!existing) throw new Error("not found");
      const updated: ArchiveFile = {
        ...existing,
        size: patch.size,
        sha256: patch.sha256,
        storage_backend: patch.storage_backend,
        storage_key: patch.storage_key,
        media_type: patch.media_type ?? existing.media_type,
        kind: patch.kind ?? existing.kind,
        updated_at: "2026-11-25 00:01:00",
      };
      files.set(id, updated);
      inlineMap.set(id, patch.inline_bytes ? new Uint8Array(patch.inline_bytes) : null);
      if (patch.searchable_text !== undefined) {
        searchTextMap.set(id, patch.searchable_text);
      }
      return updated;
    },
    listArchiveFilesMissingSearchText: async (limit = 50) =>
      [...files.values()].filter((f) => searchTextMap.get(f.id) === null).slice(0, limit),
    updateArchiveFileSearchableText: async (id: string, text: string) => {
      searchTextMap.set(id, text);
    },
    deleteArchiveFile: async (id: string) => {
      const existing = files.get(id) ?? null;
      files.delete(id);
      inlineMap.delete(id);
      searchTextMap.delete(id);
      return existing;
    },
  } as unknown as Store;

  return { store, config, files, inlineMap, searchTextMap, folders };
}

async function readStreamToBytes(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  return new Uint8Array(Buffer.concat(chunks));
}

describe("ArchiveStorageService", () => {
  const tmpDirs: string[] = [];

  afterEach(async () => {
    for (const dir of tmpDirs) {
      await rm(dir, { recursive: true, force: true });
    }
    tmpDirs.length = 0;
  });

  async function makeWorkspace() {
    const dir = await mkdtemp(path.join(os.tmpdir(), "llmwiki-archive-test-"));
    tmpDirs.push(dir);
    return dir;
  }

  it("stores small files in db and large files in local storage with range support", async () => {
    const ws = await makeWorkspace();
    const { store, inlineMap } = createMemoryArchiveStore({ archive_inline_max_bytes: "16" });
    const svc = new ArchiveStorageService(store, ws);

    const small = await svc.storeNewFile({
      folderPath: "docs",
      filename: "note.md",
      bytes: Buffer.from("hello world"),
    });
    expect(small.storage_backend).toBe("db");
    expect(small.kind).toBe("markdown");
    expect(inlineMap.get(small.id)).not.toBeNull();
    expect(new TextDecoder().decode(await svc.readFullBytes(small))).toBe("hello world");

    const largeBytes = Buffer.from("0123456789abcdefghij");
    const large = await svc.storeNewFile({
      folderPath: "media",
      filename: "clip.mp4",
      bytes: largeBytes,
    });
    expect(large.storage_backend).toBe("local");
    expect(large.kind).toBe("video");
    expect(inlineMap.get(large.id)).toBeNull();
    const diskPath = path.join(ws, ".archive-blobs", large.storage_key);
    expect((await stat(diskPath)).size).toBe(largeBytes.byteLength);

    // Range 206 read on local
    const rangeRes = await svc.openRangeStream(large, "bytes=5-14");
    expect(rangeRes.status).toBe(206);
    expect(rangeRes.contentRange).toBe("bytes 5-14/20");
    expect(new TextDecoder().decode(await readStreamToBytes(rangeRes.stream!))).toBe("56789abcde");

    // Range 206 read on db + 416 out of bounds
    const dbRange = await svc.openRangeStream(small, "bytes=-5");
    expect(dbRange.status).toBe(206);
    expect(new TextDecoder().decode(await readStreamToBytes(dbRange.stream!))).toBe("world");
    const invalidRange = await svc.openRangeStream(small, "bytes=999-1000");
    expect(invalidRange.status).toBe(416);
    expect(invalidRange.contentRange).toBe("bytes */11");
  });

  it("auto-promotes db small file to local storage when edited past threshold and cleans up on delete", async () => {
    const ws = await makeWorkspace();
    const { store, inlineMap } = createMemoryArchiveStore({ archive_inline_max_bytes: "10" });
    const svc = new ArchiveStorageService(store, ws);

    const created = await svc.storeNewFile({
      folderPath: "notes",
      filename: "edit.txt",
      bytes: Buffer.from("short"),
    });
    expect(created.storage_backend).toBe("db");
    expect(inlineMap.get(created.id)).not.toBeNull();

    const { file: promotedFile, promoted, previousBackend } = await svc.replaceFileBytes(
      created,
      Buffer.from("this content exceeds 10 bytes"),
    );
    expect(promoted).toBe(true);
    expect(previousBackend).toBe("db");
    expect(promotedFile.storage_backend).toBe("local");
    expect(inlineMap.get(created.id)).toBeNull();
    expect(new TextDecoder().decode(await svc.readFullBytes(promotedFile))).toBe("this content exceeds 10 bytes");

    const diskPath = path.join(ws, ".archive-blobs", promotedFile.storage_key);
    expect((await stat(diskPath)).isFile()).toBe(true);
    await svc.deleteFile(promotedFile.id);
    await expect(stat(diskPath)).rejects.toThrow();
  });

  it("supports s3 backend with mock client while preserving legacy db/local reads", async () => {
    const ws = await makeWorkspace();
    const objects = new Map<string, Uint8Array>();
    const { store, config } = createMemoryArchiveStore({ archive_inline_max_bytes: "8" });

    const svc = new ArchiveStorageService(store, ws, () => ({
      send: async (cmd: unknown) => {
        if (cmd instanceof PutObjectCommand) {
          objects.set(cmd.input.Key!, new Uint8Array(cmd.input.Body as Uint8Array));
          return {};
        }
        if (cmd instanceof GetObjectCommand) {
          const data = objects.get(cmd.input.Key!) ?? new Uint8Array();
          const range = cmd.input.Range;
          if (range) {
            const m = /bytes=(\d+)-(\d+)/.exec(range);
            if (m) {
              const s = Number.parseInt(m[1]!, 10);
              const e = Number.parseInt(m[2]!, 10);
              return { Body: data.subarray(s, e + 1) };
            }
          }
          return { Body: data };
        }
        if (cmd instanceof DeleteObjectCommand) {
          objects.delete(cmd.input.Key!);
          return {};
        }
        if (cmd instanceof HeadBucketCommand) {
          return {};
        }
        throw new Error("unexpected command");
      },
    }));

    const localFile = await svc.storeNewFile({
      folderPath: "legacy",
      filename: "local.bin",
      bytes: Buffer.from("1234567890"),
    });
    expect(localFile.storage_backend).toBe("local");

    config.set("archive_storage_backend", "s3");
    config.set("archive_s3_bucket", "wiki-bucket");
    config.set("archive_s3_prefix", "archives");

    const s3File = await svc.storeNewFile({
      folderPath: "cloud",
      filename: "video.mp4",
      bytes: Buffer.from("abcdefghijklmnop"),
    });
    expect(s3File.storage_backend).toBe("s3");
    expect(s3File.storage_key.startsWith("archives/")).toBe(true);
    expect(objects.has(s3File.storage_key)).toBe(true);

    // Both legacy local and new s3 remain readable
    expect(new TextDecoder().decode(await svc.readFullBytes(localFile))).toBe("1234567890");
    expect(new TextDecoder().decode(await svc.readFullBytes(s3File))).toBe("abcdefghijklmnop");

    const s3Range = await svc.openRangeStream(s3File, "bytes=2-5");
    expect(s3Range.status).toBe(206);
    expect(new TextDecoder().decode(await readStreamToBytes(s3Range.stream!))).toBe("cdef");

    const check = await svc.checkConnectivity();
    expect(check.ok).toBe(true);
    expect(check.backend).toBe("s3");

    await svc.deleteFile(s3File.id);
    expect(objects.has(s3File.storage_key)).toBe(false);
  });

  it("auto-renames duplicate filenames and computes ingest folders", async () => {
    const ws = await makeWorkspace();
    const { store } = createMemoryArchiveStore();
    const svc = new ArchiveStorageService(store, ws);

    const f1 = await svc.storeNewFile({
      folderPath: "ingest/uploads/2026-11",
      filename: "report.pdf",
      bytes: Buffer.from("a"),
      autoRename: true,
    });
    const f2 = await svc.storeNewFile({
      folderPath: "ingest/uploads/2026-11",
      filename: "report.pdf",
      bytes: Buffer.from("b"),
      autoRename: true,
    });
    expect(f1.filename).toBe("report.pdf");
    expect(f2.filename).toBe("report-2.pdf");
    expect(buildArchiveRelativePath("a/b", "c.md")).toBe("a/b/c.md");
    expect(detectArchiveKind("page.html")).toBe("html");
    expect(ingestAutoFolder("ingest_text", new Date(2026, 10, 5))).toBe("ingest/texts/2026-11");
  });

  it("extracts searchable text, escapes LIKE wildcards, builds snippets, and backfills legacy files", async () => {
    const html = Buffer.from(
      "<html><head><style>body{color:red}</style><script>var secret='ignore';</script></head><body><h1>Architecture &amp; Design</h1><p>Hybrid search &lt;v2&gt;</p></body></html>",
    );
    const extractedHtml = extractArchiveSearchableText("html", html);
    expect(extractedHtml).toContain("Architecture & Design");
    expect(extractedHtml).toContain("Hybrid search <v2>");
    expect(extractedHtml).not.toContain("secret");

    expect(extractArchiveSearchableText("image", Buffer.from("PNGDATA"))).toBe("");

    const oversized = Buffer.alloc(MAX_ARCHIVE_SEARCHABLE_BYTES + 128, "a");
    expect(extractArchiveSearchableText("text", oversized).length).toBe(MAX_ARCHIVE_SEARCHABLE_BYTES);

    expect(escapeLikePattern("100%_test\\a")).toBe("100\\%\\_test\\\\a");
    const snippet = extractSearchSnippet(
      "Prefix ".repeat(15) + "PostgreSQL full-text indexing enables fast archive content lookup." + " suffix".repeat(15),
      "full-text indexing",
      80,
    );
    expect(snippet).toContain("full-text indexing");
    expect(snippet.startsWith("…")).toBe(true);

    const ws = await makeWorkspace();
    const { store, files, searchTextMap } = createMemoryArchiveStore({ archive_inline_max_bytes: "16" });
    const svc = new ArchiveStorageService(store, ws);

    const mdFile = await svc.storeNewFile({
      folderPath: "docs",
      filename: "legacy.md",
      bytes: Buffer.from("# Legacy\n\nSearchable body keyword: zephyr."),
    });
    const binFile = await svc.storeNewFile({
      folderPath: "media",
      filename: "photo.png",
      bytes: Buffer.from("01234567890123456789"),
    });
    expect(searchTextMap.get(mdFile.id)).toContain("zephyr");
    // Simulate legacy rows before migration v8
    searchTextMap.set(mdFile.id, null);
    searchTextMap.set(binFile.id, null);
    expect(files.size).toBe(2);

    const backfilled = await svc.backfillSearchableText(10);
    expect(backfilled).toBe(2);
    expect(searchTextMap.get(mdFile.id)).toContain("zephyr");
    expect(searchTextMap.get(binFile.id)).toBe("");
  });
});
