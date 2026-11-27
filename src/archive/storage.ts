import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { logger } from "../logger.js";
import type { Store } from "../store/interfaces.js";
import {
  buildArchiveRelativePath,
  normalizeArchiveFolderPath,
  validateArchiveFilename,
} from "../store/postgres/archives.js";
import {
  CONFIG_ARCHIVE_INLINE_MAX_BYTES,
  CONFIG_ARCHIVE_LOCAL_DIR,
  CONFIG_ARCHIVE_S3_ACCESS_KEY_ID,
  CONFIG_ARCHIVE_S3_BUCKET,
  CONFIG_ARCHIVE_S3_ENDPOINT,
  CONFIG_ARCHIVE_S3_FORCE_PATH_STYLE,
  CONFIG_ARCHIVE_S3_PREFIX,
  CONFIG_ARCHIVE_S3_REGION,
  CONFIG_ARCHIVE_S3_SECRET_ACCESS_KEY,
  CONFIG_ARCHIVE_STORAGE_BACKEND,
  DEFAULT_ARCHIVE_INLINE_MAX_BYTES,
  type ArchiveFile,
  type ArchiveFileKind,
  type ArchiveFileOrigin,
  type ArchiveStorageBackend,
  type FolderDeleteMode,
} from "../store/types.js";

export const MAX_ARCHIVE_INLINE_BYTES = 10 * 1024 * 1024;
export const MAX_ARCHIVE_SEARCHABLE_BYTES = 1024 * 1024;

const EXT_TO_KIND: Record<string, ArchiveFileKind> = {
  ".md": "markdown",
  ".markdown": "markdown",
  ".mdx": "markdown",
  ".html": "html",
  ".htm": "html",
  ".png": "image",
  ".jpg": "image",
  ".jpeg": "image",
  ".gif": "image",
  ".webp": "image",
  ".svg": "image",
  ".bmp": "image",
  ".ico": "image",
  ".avif": "image",
  ".mp4": "video",
  ".webm": "video",
  ".mov": "video",
  ".m4v": "video",
  ".mkv": "video",
  ".ogv": "video",
  ".mp3": "audio",
  ".wav": "audio",
  ".ogg": "audio",
  ".m4a": "audio",
  ".flac": "audio",
  ".aac": "audio",
  ".pdf": "pdf",
  ".txt": "text",
  ".json": "text",
  ".yaml": "text",
  ".yml": "text",
  ".xml": "text",
  ".csv": "text",
  ".tsv": "text",
  ".toml": "text",
  ".ini": "text",
  ".env": "text",
  ".log": "text",
  ".ts": "text",
  ".tsx": "text",
  ".js": "text",
  ".jsx": "text",
  ".mjs": "text",
  ".cjs": "text",
  ".py": "text",
  ".go": "text",
  ".rs": "text",
  ".java": "text",
  ".c": "text",
  ".cpp": "text",
  ".h": "text",
  ".css": "text",
  ".scss": "text",
  ".sql": "text",
  ".sh": "text",
  ".bash": "text",
  ".zsh": "text",
};

const EXT_TO_MIME: Record<string, string> = {
  ".md": "text/markdown; charset=utf-8",
  ".markdown": "text/markdown; charset=utf-8",
  ".mdx": "text/markdown; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".log": "text/plain; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".yaml": "application/yaml; charset=utf-8",
  ".yml": "application/yaml; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".tsv": "text/tab-separated-values; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".ts": "text/plain; charset=utf-8",
  ".tsx": "text/plain; charset=utf-8",
  ".jsx": "text/plain; charset=utf-8",
  ".py": "text/plain; charset=utf-8",
  ".go": "text/plain; charset=utf-8",
  ".sql": "text/plain; charset=utf-8",
  ".sh": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
  ".avif": "image/avif",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".m4v": "video/x-m4v",
  ".mkv": "video/x-matroska",
  ".ogv": "video/ogg",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".m4a": "audio/mp4",
  ".flac": "audio/flac",
  ".aac": "audio/aac",
  ".pdf": "application/pdf",
};

export function detectArchiveKind(filename: string, mediaType = ""): ArchiveFileKind {
  const ext = path.extname(filename).toLowerCase();
  if (ext in EXT_TO_KIND) return EXT_TO_KIND[ext]!;
  const mime = mediaType.toLowerCase();
  if (mime.startsWith("text/markdown")) return "markdown";
  if (mime.startsWith("text/html")) return "html";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime === "application/pdf") return "pdf";
  if (mime.startsWith("text/") || mime === "application/json" || mime === "application/xml") return "text";
  return "other";
}

export function detectMediaType(filename: string, provided = ""): string {
  const clean = provided.trim();
  if (clean && clean !== "application/octet-stream") return clean;
  const ext = path.extname(filename).toLowerCase();
  return EXT_TO_MIME[ext] ?? "application/octet-stream";
}

export function isTextEditableKind(kind: ArchiveFileKind): boolean {
  return kind === "markdown" || kind === "html" || kind === "text";
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

/** Extract normalized UTF-8 searchable text (capped at 1 MB) for text-like archive files. */
export function extractArchiveSearchableText(kind: ArchiveFileKind, bytes: Uint8Array): string {
  if (!isTextEditableKind(kind) || bytes.byteLength === 0) return "";
  const slice = bytes.byteLength > MAX_ARCHIVE_SEARCHABLE_BYTES
    ? bytes.subarray(0, MAX_ARCHIVE_SEARCHABLE_BYTES)
    : bytes;
  const decoded = new TextDecoder("utf-8", { fatal: false })
    .decode(slice)
    .replace(/\u0000/g, "");
  if (kind === "html") {
    const stripped = decodeHtmlEntities(
      decoded
        .replace(/<!--[\s\S]*?-->/g, " ")
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " "),
    )
      .replace(/[ \t\f\v]+/g, " ")
      .replace(/\r\n?/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    if (stripped) return stripped;
  }
  return decoded.replace(/\r\n?/g, "\n").trim();
}

export interface ArchiveS3Config {
  endpoint: string;
  region: string;
  bucket: string;
  prefix: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

export interface ArchiveStorageConfig {
  inlineMaxBytes: number;
  backend: "local" | "s3";
  localDir: string;
  s3: ArchiveS3Config;
}

export function parseArchiveInlineMaxBytes(raw: string): number {
  const trimmed = raw.trim();
  if (!trimmed) return DEFAULT_ARCHIVE_INLINE_MAX_BYTES;
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed) || String(parsed) !== trimmed) {
    throw new Error(`invalid ${CONFIG_ARCHIVE_INLINE_MAX_BYTES}: "${raw}"`);
  }
  if (parsed < 0 || parsed > MAX_ARCHIVE_INLINE_BYTES) {
    throw new Error(`${CONFIG_ARCHIVE_INLINE_MAX_BYTES} must be between 0 and ${MAX_ARCHIVE_INLINE_BYTES}`);
  }
  return parsed;
}

export function defaultArchiveLocalDir(workspace: string): string {
  if (workspace.trim()) return path.join(workspace, ".archive-blobs");
  const dataDir = (process.env.LLMWIKI_DATA_DIR ?? "").trim();
  if (dataDir) return path.join(dataDir, "archive-blobs");
  return path.join(os.homedir(), ".llmwiki", "archive-blobs");
}

export function parseArchiveStorageConfig(
  allConfig: Record<string, string | undefined>,
  workspace: string,
): ArchiveStorageConfig {
  let inlineMaxBytes = DEFAULT_ARCHIVE_INLINE_MAX_BYTES;
  const rawInline = allConfig[CONFIG_ARCHIVE_INLINE_MAX_BYTES] ?? "";
  if (rawInline.trim()) {
    try {
      inlineMaxBytes = parseArchiveInlineMaxBytes(rawInline);
    } catch {
      inlineMaxBytes = DEFAULT_ARCHIVE_INLINE_MAX_BYTES;
    }
  }
  const rawBackend = (allConfig[CONFIG_ARCHIVE_STORAGE_BACKEND] ?? "").trim().toLowerCase();
  const backend: "local" | "s3" = rawBackend === "s3" ? "s3" : "local";
  const customLocal = (allConfig[CONFIG_ARCHIVE_LOCAL_DIR] ?? "").trim();
  const localDir = customLocal || defaultArchiveLocalDir(workspace);
  const rawForcePathStyle = (allConfig[CONFIG_ARCHIVE_S3_FORCE_PATH_STYLE] ?? "").trim().toLowerCase();
  const prefix = (allConfig[CONFIG_ARCHIVE_S3_PREFIX] ?? "").trim().replace(/^\/+|\/+$/g, "");
  return {
    inlineMaxBytes,
    backend,
    localDir,
    s3: {
      endpoint: (allConfig[CONFIG_ARCHIVE_S3_ENDPOINT] ?? "").trim(),
      region: (allConfig[CONFIG_ARCHIVE_S3_REGION] ?? "").trim() || "us-east-1",
      bucket: (allConfig[CONFIG_ARCHIVE_S3_BUCKET] ?? "").trim(),
      prefix,
      accessKeyId: (allConfig[CONFIG_ARCHIVE_S3_ACCESS_KEY_ID] ?? "").trim(),
      secretAccessKey: (allConfig[CONFIG_ARCHIVE_S3_SECRET_ACCESS_KEY] ?? "").trim(),
      forcePathStyle: rawForcePathStyle === "true" || rawForcePathStyle === "1",
    },
  };
}

export interface S3LikeClient {
  send(command: unknown): Promise<unknown>;
}

export type S3ClientFactory = (cfg: ArchiveS3Config) => S3LikeClient;

function defaultS3ClientFactory(cfg: ArchiveS3Config): S3LikeClient {
  if (!cfg.bucket) throw new Error("archive_s3_bucket is required for s3 storage");
  return new S3Client({
    region: cfg.region || "us-east-1",
    endpoint: cfg.endpoint || undefined,
    forcePathStyle: cfg.forcePathStyle,
    credentials:
      cfg.accessKeyId && cfg.secretAccessKey
        ? { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey }
        : undefined,
  });
}

export interface RangeReadResult {
  status: 200 | 206 | 416;
  stream?: ReadableStream<Uint8Array>;
  contentLength: number;
  contentRange?: string;
  totalSize: number;
}

export function parseByteRange(
  rangeHeader: string | null | undefined,
  totalSize: number,
): { ok: true; start: number; end: number; partial: boolean } | { ok: false } {
  if (!rangeHeader || !rangeHeader.trim()) {
    if (totalSize === 0) return { ok: true, start: 0, end: -1, partial: false };
    return { ok: true, start: 0, end: totalSize - 1, partial: false };
  }
  const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim());
  if (!match) return { ok: false };
  if (totalSize === 0) return { ok: false };
  const rawStart = match[1] ?? "";
  const rawEnd = match[2] ?? "";
  if (!rawStart && !rawEnd) return { ok: false };

  let start = 0;
  let end = totalSize - 1;
  if (!rawStart) {
    const suffix = Number.parseInt(rawEnd, 10);
    if (!Number.isFinite(suffix) || suffix <= 0) return { ok: false };
    start = Math.max(0, totalSize - suffix);
  } else {
    start = Number.parseInt(rawStart, 10);
    if (!Number.isFinite(start) || start < 0 || start >= totalSize) return { ok: false };
    if (rawEnd) {
      end = Math.min(totalSize - 1, Number.parseInt(rawEnd, 10));
      if (!Number.isFinite(end) || end < start) return { ok: false };
    }
  }
  return { ok: true, start, end, partial: true };
}

function bytesToWebStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      if (bytes.byteLength > 0) controller.enqueue(bytes);
      controller.close();
    },
  });
}

async function bodyToBytes(body: unknown): Promise<Uint8Array> {
  if (!body) return new Uint8Array();
  if (body instanceof Uint8Array) return body;
  if (typeof (body as { transformToByteArray?: () => Promise<Uint8Array> }).transformToByteArray === "function") {
    return (body as { transformToByteArray: () => Promise<Uint8Array> }).transformToByteArray();
  }
  if (body instanceof Readable) {
    const chunks: Buffer[] = [];
    for await (const chunk of body) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return new Uint8Array(Buffer.concat(chunks));
  }
  throw new Error("unsupported s3 response body type");
}

function bodyToWebStream(body: unknown): ReadableStream<Uint8Array> {
  if (!body) return bytesToWebStream(new Uint8Array());
  if (body instanceof Uint8Array) return bytesToWebStream(body);
  if (typeof (body as { transformToWebStream?: () => ReadableStream<Uint8Array> }).transformToWebStream === "function") {
    return (body as { transformToWebStream: () => ReadableStream<Uint8Array> }).transformToWebStream();
  }
  if (body instanceof Readable) {
    return Readable.toWeb(body) as ReadableStream<Uint8Array>;
  }
  throw new Error("unsupported s3 stream body type");
}

export function extractArchiveTitle(
  kind: ArchiveFileKind,
  filename: string,
  bytes: Uint8Array,
  explicitTitle = "",
): string {
  const explicit = explicitTitle.trim();
  if (explicit) return explicit;
  if (kind === "markdown" || kind === "text") {
    const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes.subarray(0, 8192));
    const fmMatch = /^---\s*\n([\s\S]*?)\n---/.exec(text);
    if (fmMatch) {
      const titleLine = /^title:\s*(.+)$/m.exec(fmMatch[1] ?? "");
      if (titleLine?.[1]) {
        const clean = titleLine[1].trim().replace(/^['"]|['"]$/g, "");
        if (clean) return clean;
      }
    }
    const h1 = /^#\s+(.+)$/m.exec(text);
    if (h1?.[1]?.trim()) return h1[1].trim();
  }
  const dot = filename.lastIndexOf(".");
  return dot > 0 ? filename.slice(0, dot) : filename;
}

export function ingestAutoFolder(origin: ArchiveFileOrigin, now = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const ym = `${year}-${month}`;
  switch (origin) {
    case "ingest_upload":
      return `ingest/uploads/${ym}`;
    case "ingest_text":
      return `ingest/texts/${ym}`;
    case "ingest_conversation":
      return `ingest/conversations/${ym}`;
    case "ingest_session":
      return `ingest/sessions/${ym}`;
    default:
      return `uploads/${ym}`;
  }
}

export class ArchiveStorageService {
  constructor(
    private readonly db: Store,
    private readonly workspace: string,
    private readonly s3Factory: S3ClientFactory = defaultS3ClientFactory,
  ) {}

  async getConfig(): Promise<ArchiveStorageConfig> {
    const all = await this.db.getAllConfig();
    return parseArchiveStorageConfig(all, this.workspace);
  }

  private resolveLocalPath(cfg: ArchiveStorageConfig, storageKey: string): string {
    if (!cfg.localDir) {
      throw new Error("archive local storage directory is not configured");
    }
    const cleaned = storageKey.replace(/^\/+/, "");
    const root = path.resolve(cfg.localDir);
    const full = path.resolve(root, cleaned);
    if (full !== root && !full.startsWith(`${root}${path.sep}`)) {
      throw new Error("invalid local storage key");
    }
    return full;
  }

  private async writeExternal(
    cfg: ArchiveStorageConfig,
    fileId: string,
    sha256: string,
    bytes: Uint8Array,
    mediaType: string,
  ): Promise<{ backend: "local" | "s3"; key: string }> {
    const shard = sha256.slice(0, 2) || "00";
    if (cfg.backend === "s3") {
      const key = [cfg.s3.prefix, shard, fileId].filter(Boolean).join("/");
      const client = this.s3Factory(cfg.s3);
      await client.send(
        new PutObjectCommand({
          Bucket: cfg.s3.bucket,
          Key: key,
          Body: bytes,
          ContentType: mediaType,
        }),
      );
      return { backend: "s3", key };
    }
    const key = `${shard}/${fileId}`;
    const fullPath = this.resolveLocalPath(cfg, key);
    await mkdir(path.dirname(fullPath), { recursive: true, mode: 0o755 });
    const tmp = `${fullPath}.tmp-${randomUUID()}`;
    try {
      await writeFile(tmp, bytes);
      await rename(tmp, fullPath);
    } catch (error) {
      await rm(tmp, { force: true }).catch(() => undefined);
      throw error;
    }
    return { backend: "local", key };
  }

  private async deleteExternal(
    cfg: ArchiveStorageConfig,
    backend: ArchiveStorageBackend,
    key: string,
  ): Promise<void> {
    if (!key || backend === "db") return;
    try {
      if (backend === "local") {
        await rm(this.resolveLocalPath(cfg, key), { force: true });
      } else if (backend === "s3" && cfg.s3.bucket) {
        const client = this.s3Factory(cfg.s3);
        await client.send(new DeleteObjectCommand({ Bucket: cfg.s3.bucket, Key: key }));
      }
    } catch (error) {
      logger.warn({ error, backend, key }, "archive: cleanup external object failed");
    }
  }

  async resolveUniqueFilename(folderPath: string, filename: string): Promise<string> {
    const normFolder = normalizeArchiveFolderPath(folderPath);
    const validName = validateArchiveFilename(filename);
    const rel = buildArchiveRelativePath(normFolder, validName);
    if (!(await this.db.getArchiveFileByRelativePath(rel))) return validName;

    const ext = path.posix.extname(validName);
    const stem = ext ? validName.slice(0, -ext.length) : validName;
    for (let idx = 2; idx < 10000; idx += 1) {
      const candidate = `${stem}-${idx}${ext}`;
      const candidateRel = buildArchiveRelativePath(normFolder, candidate);
      if (!(await this.db.getArchiveFileByRelativePath(candidateRel))) return candidate;
    }
    return `${stem}-${randomUUID().slice(0, 8)}${ext}`;
  }

  async storeNewFile(input: {
    folderPath: string;
    filename: string;
    title?: string;
    bytes: Uint8Array;
    mediaType?: string;
    origin?: ArchiveFileOrigin;
    sourceRef?: string;
    ingestJobId?: string;
    overwrite?: boolean;
    autoRename?: boolean;
    dedup?: "none" | "reuse";
  }): Promise<ArchiveFile> {
    const cfg = await this.getConfig();
    const folderPath = normalizeArchiveFolderPath(input.folderPath);
    let filename = validateArchiveFilename(input.filename);
    const sha256 = createHash("sha256").update(input.bytes).digest("hex");
    const mediaType = detectMediaType(filename, input.mediaType);
    const kind = detectArchiveKind(filename, mediaType);
    const extractedTitle = extractArchiveTitle(kind, filename, input.bytes, input.title);

    if (input.dedup === "reuse" && typeof this.db.findArchiveFileBySha256 === "function") {
      const existingBySha = await this.db.findArchiveFileBySha256(sha256);
      if (existingBySha) {
        if (!existingBySha.title && extractedTitle && typeof this.db.updateArchiveFileTitle === "function") {
          const updated = await this.db.updateArchiveFileTitle(existingBySha.id, extractedTitle);
          if (updated) return updated;
        }
        return existingBySha;
      }
    }

    if (input.autoRename) {
      filename = await this.resolveUniqueFilename(folderPath, filename);
    }

    const relPath = buildArchiveRelativePath(folderPath, filename);
    if (input.overwrite) {
      const existing = await this.db.getArchiveFileByRelativePath(relPath);
      if (existing) {
        const { file } = await this.replaceFileBytes(existing, input.bytes, input.mediaType);
        return file;
      }
    }

    const id = randomUUID();

    let storageBackend: ArchiveStorageBackend = "db";
    let storageKey = "";
    let inlineBytes: Uint8Array | null = input.bytes;

    if (input.bytes.byteLength > cfg.inlineMaxBytes) {
      const ext = await this.writeExternal(cfg, id, sha256, input.bytes, mediaType);
      storageBackend = ext.backend;
      storageKey = ext.key;
      inlineBytes = null;
    }

    const record: ArchiveFile = {
      id,
      folder_path: folderPath,
      filename,
      title: extractedTitle,
      relative_path: relPath,
      media_type: mediaType,
      kind,
      size: input.bytes.byteLength,
      sha256,
      storage_backend: storageBackend,
      storage_key: storageKey,
      origin: input.origin ?? "upload",
      source_ref: input.sourceRef ?? "",
      ingest_job_id: input.ingestJobId ?? "",
      created_at: "",
      updated_at: "",
    };

    const searchableText = extractArchiveSearchableText(kind, input.bytes);

    try {
      return await this.db.createArchiveFile(record, inlineBytes, searchableText);
    } catch (error) {
      if (storageBackend !== "db" && storageKey) {
        await this.deleteExternal(cfg, storageBackend, storageKey);
      }
      throw error;
    }
  }

  async replaceFileBytes(
    file: ArchiveFile,
    bytes: Uint8Array,
    mediaTypeOverride?: string,
  ): Promise<{ file: ArchiveFile; promoted: boolean; previousBackend: ArchiveStorageBackend }> {
    const cfg = await this.getConfig();
    const mediaType = mediaTypeOverride ? detectMediaType(file.filename, mediaTypeOverride) : file.media_type;
    const kind = detectArchiveKind(file.filename, mediaType);
    const sha256 = createHash("sha256").update(bytes).digest("hex");

    let nextBackend: ArchiveStorageBackend = "db";
    let nextKey = "";
    let inlineBytes: Uint8Array | null = bytes;

    if (bytes.byteLength > cfg.inlineMaxBytes) {
      const ext = await this.writeExternal(cfg, file.id, sha256, bytes, mediaType);
      nextBackend = ext.backend;
      nextKey = ext.key;
      inlineBytes = null;
    }

    const prevBackend = file.storage_backend;
    const prevKey = file.storage_key;
    const searchableText = extractArchiveSearchableText(kind, bytes);

    let updated: ArchiveFile;
    try {
      updated = await this.db.updateArchiveFileContentMeta(file.id, {
        size: bytes.byteLength,
        sha256,
        storage_backend: nextBackend,
        storage_key: nextKey,
        inline_bytes: inlineBytes,
        media_type: mediaType,
        kind,
        searchable_text: searchableText,
      });
    } catch (error) {
      if (nextBackend !== "db" && nextKey) {
        await this.deleteExternal(cfg, nextBackend, nextKey);
      }
      throw error;
    }

    if (prevBackend !== "db" && prevKey && (prevBackend !== nextBackend || prevKey !== nextKey)) {
      await this.deleteExternal(cfg, prevBackend, prevKey);
    }

    return {
      file: updated,
      promoted: prevBackend === "db" && nextBackend !== "db",
      previousBackend: prevBackend,
    };
  }

  /** Backfill `searchable_text` for legacy rows where `searchable_text IS NULL`. */
  async backfillSearchableText(batchSize = 50): Promise<number> {
    if (
      typeof this.db.listArchiveFilesMissingSearchText !== "function" ||
      typeof this.db.updateArchiveFileSearchableText !== "function"
    ) {
      return 0;
    }
    const pending = await this.db.listArchiveFilesMissingSearchText(batchSize);
    let updated = 0;
    for (const file of pending) {
      try {
        if (!isTextEditableKind(file.kind)) {
          await this.db.updateArchiveFileSearchableText(file.id, "");
          updated += 1;
          continue;
        }
        let bytes: Uint8Array;
        if (file.size <= MAX_ARCHIVE_SEARCHABLE_BYTES) {
          bytes = await this.readFullBytes(file);
        } else {
          const rangeRes = await this.openRangeStream(
            file,
            `bytes=0-${MAX_ARCHIVE_SEARCHABLE_BYTES - 1}`,
          );
          if (rangeRes.stream) {
            const reader = rangeRes.stream.getReader();
            const chunks: Uint8Array[] = [];
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              if (value) chunks.push(value);
            }
            bytes = new Uint8Array(Buffer.concat(chunks));
          } else {
            bytes = new Uint8Array();
          }
        }
        const text = extractArchiveSearchableText(file.kind, bytes);
        await this.db.updateArchiveFileSearchableText(file.id, text);
        updated += 1;
      } catch (error) {
        logger.warn({ error, fileId: file.id, path: file.relative_path }, "archive: backfill searchable_text failed");
      }
    }
    return updated;
  }

  async readFullBytes(file: ArchiveFile): Promise<Uint8Array> {
    if (file.storage_backend === "db") {
      return (await this.db.getArchiveFileInlineBytes(file.id)) ?? new Uint8Array();
    }
    const cfg = await this.getConfig();
    if (file.storage_backend === "local") {
      return new Uint8Array(await readFile(this.resolveLocalPath(cfg, file.storage_key)));
    }
    const client = this.s3Factory(cfg.s3);
    const resp = (await client.send(
      new GetObjectCommand({ Bucket: cfg.s3.bucket, Key: file.storage_key }),
    )) as { Body?: unknown };
    return bodyToBytes(resp.Body);
  }

  async openRangeStream(file: ArchiveFile, rangeHeader?: string | null): Promise<RangeReadResult> {
    const cfg = await this.getConfig();
    let totalSize = file.size;

    if (file.storage_backend === "local") {
      const info = await stat(this.resolveLocalPath(cfg, file.storage_key));
      totalSize = info.size;
    } else if (file.storage_backend === "db" && totalSize === 0) {
      const inline = await this.db.getArchiveFileInlineBytes(file.id);
      totalSize = inline?.byteLength ?? 0;
    }

    const parsed = parseByteRange(rangeHeader, totalSize);
    if (!parsed.ok) {
      return {
        status: 416,
        contentLength: 0,
        contentRange: `bytes */${totalSize}`,
        totalSize,
      };
    }

    if (totalSize === 0) {
      return {
        status: 200,
        stream: bytesToWebStream(new Uint8Array()),
        contentLength: 0,
        totalSize: 0,
      };
    }

    const { start, end, partial } = parsed;
    const contentLength = end - start + 1;
    const contentRange = `bytes ${start}-${end}/${totalSize}`;

    if (file.storage_backend === "db") {
      const bytes = (await this.db.getArchiveFileInlineBytes(file.id)) ?? new Uint8Array();
      const slice = bytes.subarray(start, end + 1);
      return {
        status: partial ? 206 : 200,
        stream: bytesToWebStream(slice),
        contentLength: slice.byteLength,
        contentRange: partial ? contentRange : undefined,
        totalSize,
      };
    }

    if (file.storage_backend === "local") {
      const nodeStream = createReadStream(this.resolveLocalPath(cfg, file.storage_key), { start, end });
      return {
        status: partial ? 206 : 200,
        stream: Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>,
        contentLength,
        contentRange: partial ? contentRange : undefined,
        totalSize,
      };
    }

    const client = this.s3Factory(cfg.s3);
    const resp = (await client.send(
      new GetObjectCommand({
        Bucket: cfg.s3.bucket,
        Key: file.storage_key,
        Range: partial ? `bytes=${start}-${end}` : undefined,
      }),
    )) as { Body?: unknown };
    return {
      status: partial ? 206 : 200,
      stream: bodyToWebStream(resp.Body),
      contentLength,
      contentRange: partial ? contentRange : undefined,
      totalSize,
    };
  }

  async deleteFile(id: string): Promise<ArchiveFile | null> {
    const deleted = await this.db.deleteArchiveFile(id);
    if (!deleted) return null;
    if (deleted.storage_backend !== "db" && deleted.storage_key) {
      const cfg = await this.getConfig();
      await this.deleteExternal(cfg, deleted.storage_backend, deleted.storage_key);
    }
    return deleted;
  }

  async deleteFolder(folderPath: string, mode: FolderDeleteMode, targetFolder?: string) {
    const res = await this.db.deleteArchiveFolder(folderPath, mode, targetFolder);
    if (res.removed_storage_refs.length > 0) {
      const cfg = await this.getConfig();
      for (const ref of res.removed_storage_refs) {
        await this.deleteExternal(cfg, ref.storage_backend, ref.storage_key);
      }
    }
    return res;
  }

  async checkConnectivity(override?: Partial<Record<string, string>>): Promise<{
    ok: boolean;
    backend: "local" | "s3";
    target: string;
    message: string;
  }> {
    const all = { ...(await this.db.getAllConfig()), ...(override ?? {}) };
    const cfg = parseArchiveStorageConfig(all, this.workspace);
    if (cfg.backend === "local") {
      if (!cfg.localDir) {
        return { ok: false, backend: "local", target: "", message: "本地存储目录未配置且无有效工作区" };
      }
      try {
        await mkdir(cfg.localDir, { recursive: true, mode: 0o755 });
        const probe = path.join(cfg.localDir, `.probe-${randomUUID()}`);
        await writeFile(probe, "ok");
        await rm(probe, { force: true });
        return { ok: true, backend: "local", target: cfg.localDir, message: "本地目录可读写" };
      } catch (error) {
        return {
          ok: false,
          backend: "local",
          target: cfg.localDir,
          message: error instanceof Error ? error.message : String(error),
        };
      }
    }
    const target = cfg.s3.endpoint ? `${cfg.s3.endpoint}/${cfg.s3.bucket}` : cfg.s3.bucket;
    if (!cfg.s3.bucket) {
      return { ok: false, backend: "s3", target, message: "S3 Bucket 不能为空" };
    }
    try {
      const client = this.s3Factory(cfg.s3);
      await client.send(new HeadBucketCommand({ Bucket: cfg.s3.bucket }));
      return { ok: true, backend: "s3", target, message: "S3 存储桶连通正常" };
    } catch (error) {
      return {
        ok: false,
        backend: "s3",
        target,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
