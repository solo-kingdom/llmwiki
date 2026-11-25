import path from "node:path";
import { logIngestJob } from "../activity/index.js";
import { SUPPORTED_INGEST_EXTENSIONS } from "../api/ingest_jobs.js";
import { ArchiveStorageService, isTextEditableKind } from "../archive/storage.js";
import { recordRulesSnapshot } from "../ingest/processor.js";
import type { Store } from "../store/interfaces.js";
import type { FolderDeleteMode, IngestJob } from "../store/types.js";
import type { Tool, ToolHandler } from "./types.js";

const MAX_MCP_TEXT_READ_BYTES = 256 * 1024;

export function registerArchiveTools(
  register: (tool: Tool, handler: ToolHandler) => void,
  workspace: string,
  db: Store,
): void {
  const storage = () => new ArchiveStorageService(db, workspace);

  register(
    {
      name: "archive_list",
      description:
        "List folders and files in the Archives module (raw/uploaded files separate from Wiki pages).",
      inputSchema: {
        type: "object",
        properties: {
          folder: { type: "string", description: "Filter by folder path (optional)" },
          kind: {
            type: "string",
            enum: ["markdown", "html", "image", "video", "audio", "pdf", "text", "other"],
            description: "Filter by file kind (optional)",
          },
          query: { type: "string", description: "Filename or path substring filter (optional)" },
        },
        required: [],
      },
    },
    async (args) => {
      if (!db) return "Error: database not connected";
      const folder = typeof args["folder"] === "string" ? args["folder"] : "";
      const kind = typeof args["kind"] === "string" ? args["kind"] : "";
      const q = typeof args["query"] === "string" ? args["query"] : "";
      const [folders, files] = await Promise.all([
        db.listArchiveFolders(),
        db.listArchiveFiles({ folder_path: folder, kind, q }),
      ]);
      const folderLines =
        folders.length === 0
          ? ["(none)"]
          : folders.map((f) => `- ${f.path}/ (${f.total_count} files)`);
      const fileLines =
        files.length === 0
          ? ["(none)"]
          : files.map(
              (f) =>
                `- [${f.id}] ${f.relative_path} (${f.kind}, ${f.size} bytes, backend=${f.storage_backend})`,
            );
      return [
        `## Archive Folders (${folders.length})`,
        ...folderLines,
        "",
        `## Archive Files (${files.length})`,
        ...fileLines,
      ].join("\n");
    },
  );

  register(
    {
      name: "archive_read",
      description:
        "Read archive file metadata, linked wiki documents, and text content (for markdown/html/text <= 256KB).",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Archive file ID" },
          path: { type: "string", description: "Archive relative_path (e.g. docs/readme.md)" },
        },
        required: [],
      },
    },
    async (args) => {
      if (!db) return "Error: database not connected";
      const id = typeof args["id"] === "string" ? args["id"].trim() : "";
      const relPath = typeof args["path"] === "string" ? args["path"].trim() : "";
      if (!id && !relPath) return "Error: id or path is required";

      const file = id ? await db.getArchiveFile(id) : await db.getArchiveFileByRelativePath(relPath);
      if (!file) return `Archive file not found: ${id || relPath}`;

      const linkedDocs =
        typeof db.listArchiveFileDocuments === "function"
          ? await db.listArchiveFileDocuments(file.id)
          : [];
      const header = [
        `# ${file.relative_path}`,
        `- id: ${file.id}`,
        `- kind: ${file.kind}`,
        `- media_type: ${file.media_type}`,
        `- size: ${file.size} bytes`,
        `- storage_backend: ${file.storage_backend}`,
        `- origin: ${file.origin}`,
        `- raw_url: /api/v1/archives/files/${file.id}/raw`,
        `- linked_wiki_documents: ${
          linkedDocs.length === 0
            ? "none"
            : linkedDocs.map((d) => `${d.title || d.relative_path} (${d.relative_path})`).join(", ")
        }`,
      ].join("\n");

      if (isTextEditableKind(file.kind) && file.size <= MAX_MCP_TEXT_READ_BYTES) {
        const bytes = await storage().readFullBytes(file);
        const text = new TextDecoder().decode(bytes);
        return `${header}\n\n---\n\n${text}`;
      }
      return `${header}\n\n(Binary or oversized file; download via /api/v1/archives/files/${file.id}/raw?download=1)`;
    },
  );

  register(
    {
      name: "archive_mkdir",
      description: "Create a folder (and missing parent folders) in Archives.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Folder path (e.g. projects/specs)" },
          display_name: { type: "string" },
          description: { type: "string" },
        },
        required: ["path"],
      },
    },
    async (args) => {
      if (!db) return "Error: database not connected";
      const folderPath = typeof args["path"] === "string" ? args["path"] : "";
      if (!folderPath.trim()) return "Error: path is required";
      const folder = await db.createArchiveFolder({
        path: folderPath,
        display_name: typeof args["display_name"] === "string" ? args["display_name"] : undefined,
        description: typeof args["description"] === "string" ? args["description"] : undefined,
      });
      return `Created archive folder: ${folder.path}`;
    },
  );

  register(
    {
      name: "archive_upload",
      description:
        "Upload or overwrite a file in Archives (supports UTF-8 content or base64 binary content_base64).",
      inputSchema: {
        type: "object",
        properties: {
          filename: { type: "string", description: "Filename (e.g. demo.html)" },
          folder_path: { type: "string", description: "Target folder path (default root)" },
          content: { type: "string", description: "UTF-8 text content" },
          content_base64: { type: "string", description: "Base64 encoded binary content" },
          media_type: { type: "string" },
          overwrite: { type: "boolean", default: false },
        },
        required: ["filename"],
      },
    },
    async (args) => {
      if (!db) return "Error: database not connected";
      const filename = typeof args["filename"] === "string" ? args["filename"].trim() : "";
      if (!filename) return "Error: filename is required";
      const folderPath = typeof args["folder_path"] === "string" ? args["folder_path"] : "";
      const content = typeof args["content"] === "string" ? args["content"] : undefined;
      const contentBase64 = typeof args["content_base64"] === "string" ? args["content_base64"] : undefined;
      if (content === undefined && contentBase64 === undefined) {
        return "Error: either content or content_base64 is required";
      }
      const bytes =
        contentBase64 !== undefined
          ? new Uint8Array(Buffer.from(contentBase64, "base64"))
          : new Uint8Array(Buffer.from(content ?? "", "utf8"));
      const saved = await storage().storeNewFile({
        folderPath,
        filename,
        bytes,
        mediaType: typeof args["media_type"] === "string" ? args["media_type"] : undefined,
        origin: "upload",
        overwrite: Boolean(args["overwrite"]),
      });
      return `Uploaded archive file [${saved.id}] ${saved.relative_path} (${saved.size} bytes, backend=${saved.storage_backend})`;
    },
  );

  register(
    {
      name: "archive_move",
      description: "Move or rename an archive file or folder.",
      inputSchema: {
        type: "object",
        properties: {
          target_type: { type: "string", enum: ["file", "folder"] },
          id: { type: "string", description: "File ID (when target_type=file)" },
          from_path: { type: "string", description: "Source folder path (when target_type=folder)" },
          to_folder: { type: "string", description: "Destination folder for file" },
          new_filename: { type: "string", description: "New filename for file" },
          to_path: { type: "string", description: "Destination folder path (when target_type=folder)" },
        },
        required: ["target_type"],
      },
    },
    async (args) => {
      if (!db) return "Error: database not connected";
      const targetType = args["target_type"];
      if (targetType === "folder") {
        const fromPath = typeof args["from_path"] === "string" ? args["from_path"] : "";
        const toPath = typeof args["to_path"] === "string" ? args["to_path"] : "";
        if (!fromPath || !toPath) return "Error: from_path and to_path are required";
        const res = await db.moveArchiveFolder(fromPath, toPath);
        return `Moved folder ${res.from_path} -> ${res.to_path} (${res.moved_files} files)`;
      }
      if (targetType === "file") {
        const id = typeof args["id"] === "string" ? args["id"] : "";
        if (!id) return "Error: id is required for file move";
        const existing = await db.getArchiveFile(id);
        if (!existing) return `Archive file not found: ${id}`;
        const toFolder =
          typeof args["to_folder"] === "string" ? args["to_folder"] : existing.folder_path;
        const newFilename =
          typeof args["new_filename"] === "string" ? args["new_filename"] : existing.filename;
        const updated = await db.updateArchiveFileLocation(id, toFolder, newFilename);
        return `Moved file [${updated.id}] to ${updated.relative_path}`;
      }
      return "Error: target_type must be file or folder";
    },
  );

  register(
    {
      name: "archive_delete",
      description: "Delete an archive file or folder (and clean up external storage objects).",
      inputSchema: {
        type: "object",
        properties: {
          target_type: { type: "string", enum: ["file", "folder"] },
          id: { type: "string", description: "File ID (when target_type=file)" },
          path: { type: "string", description: "Folder path (when target_type=folder)" },
          mode: {
            type: "string",
            enum: ["empty", "move_to_parent", "cascade"],
            default: "empty",
          },
        },
        required: ["target_type"],
      },
    },
    async (args) => {
      if (!db) return "Error: database not connected";
      const targetType = args["target_type"];
      if (targetType === "file") {
        const id = typeof args["id"] === "string" ? args["id"] : "";
        if (!id) return "Error: id is required";
        const deleted = await storage().deleteFile(id);
        if (!deleted) return `Archive file not found: ${id}`;
        return `Deleted archive file [${deleted.id}] ${deleted.relative_path}`;
      }
      if (targetType === "folder") {
        const folderPath = typeof args["path"] === "string" ? args["path"] : "";
        if (!folderPath) return "Error: path is required";
        const mode = (typeof args["mode"] === "string" ? args["mode"] : "empty") as FolderDeleteMode;
        const res = await storage().deleteFolder(folderPath, mode);
        return `Deleted archive folder ${res.path} (mode=${res.mode}, deleted_files=${res.deleted_files})`;
      }
      return "Error: target_type must be file or folder";
    },
  );

  register(
    {
      name: "archive_link",
      description: "Link or unlink an archive file to a Wiki document as its source.",
      inputSchema: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["link", "unlink"] },
          document_id: { type: "string", description: "Wiki document ID" },
          archive_file_id: { type: "string", description: "Archive file ID" },
          path: { type: "string", description: "Archive relative_path (alternative to archive_file_id)" },
          relation: { type: "string", default: "manual_link" },
        },
        required: ["action", "document_id"],
      },
    },
    async (args) => {
      if (!db) return "Error: database not connected";
      const action = args["action"];
      const docId = typeof args["document_id"] === "string" ? args["document_id"].trim() : "";
      if (!docId) return "Error: document_id is required";
      const doc = await db.getDocument(docId);
      if (!doc) return `Document not found: ${docId}`;

      const fileId = typeof args["archive_file_id"] === "string" ? args["archive_file_id"].trim() : "";
      const relPath = typeof args["path"] === "string" ? args["path"].trim().replace(/^\/+/, "") : "";
      const file = fileId
        ? await db.getArchiveFile(fileId)
        : relPath
          ? await db.getArchiveFileByRelativePath(relPath)
          : null;
      if (!file) return `Archive file not found: ${fileId || relPath}`;

      if (action === "link") {
        const relation = typeof args["relation"] === "string" && args["relation"].trim()
          ? args["relation"].trim()
          : "manual_link";
        await db.linkDocumentArchiveSource(doc.id, file.id, "", relation);
        return `Linked archive [${file.id}] ${file.relative_path} -> wiki [${doc.id}] ${doc.relative_path}`;
      }
      if (action === "unlink") {
        const ok = await db.unlinkDocumentArchiveSource(doc.id, file.id);
        return ok
          ? `Unlinked archive [${file.id}] from wiki [${doc.id}]`
          : `Link not found between archive [${file.id}] and wiki [${doc.id}]`;
      }
      return "Error: action must be link or unlink";
    },
  );

  register(
    {
      name: "archive_ingest",
      description: "Queue a Wiki ingest job from an existing file in Archives.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Archive file ID" },
          path: { type: "string", description: "Archive relative_path (alternative to id)" },
          source_ref: { type: "string", description: "Optional source reference label" },
        },
        required: [],
      },
    },
    async (args) => {
      if (!db) return "Error: database not connected";
      if (!workspace.trim()) return "Error: workspace not configured for ingest";
      const id = typeof args["id"] === "string" ? args["id"].trim() : "";
      const relPath = typeof args["path"] === "string" ? args["path"].trim().replace(/^\/+/, "") : "";
      if (!id && !relPath) return "Error: id or path is required";
      const file = id ? await db.getArchiveFile(id) : await db.getArchiveFileByRelativePath(relPath);
      if (!file) return `Archive file not found: ${id || relPath}`;
      const ext = path.extname(file.filename).toLowerCase();
      if (!SUPPORTED_INGEST_EXTENSIONS.has(ext)) {
        return `Error: unsupported file extension for ingest: ${ext || "(none)"}`;
      }
      const sourceRef =
        typeof args["source_ref"] === "string" && args["source_ref"].trim()
          ? args["source_ref"].trim()
          : `archive:${file.relative_path}`;
      const job: IngestJob = {
        id: "",
        parent_job_id: "",
        input_type: "upload",
        source_path: file.relative_path,
        source_ref: sourceRef,
        archive_file_id: file.id,
        status: "queued",
        retries: 0,
        max_retries: 3,
        error: "",
        error_code: "",
        error_message: "",
        missing_dependency: "",
        remediation: "",
        result_summary: "",
        created_at: "",
        updated_at: "",
      };
      await db.createIngestJob(job);
      await recordRulesSnapshot(db, job.id, workspace);
      logIngestJob(db, job, "queued", "mcp");
      return `Queued ingest job [${job.id}] from archive [${file.id}] ${file.relative_path}`;
    },
  );
}
