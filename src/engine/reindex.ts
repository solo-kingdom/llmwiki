import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { chunkText, defaultChunkConfig } from "./chunker.js";
import { getMetadataJSON, parseFrontmatter, titleFromFilename } from "./frontmatter.js";
import { ReferenceParser } from "./references.js";
import type { ChunkData, DocData, EngineStore } from "./store_iface.js";
import { folderPathFromWikiRelPath, resolvePageType } from "./wiki_org.js";

const IGNORE_DIRS = new Set([".llmwiki", ".git", ".obsidian", "node_modules", "__pycache__", ".venv", "venv"]);
const SKIP_LEGACY_REL_PATHS = new Set(["wiki/index.md", "wiki/log.md"]);
const TEXT_TYPES = new Set(["md", "txt", "csv", "html", "svg", "json", "xml"]);

export class Reindexer {
  constructor(
    private readonly store: EngineStore,
    private readonly workspace: string,
  ) {}

  /** One-way import of existing workspace markdown/text files into PostgreSQL. */
  async rebuild(userID: string): Promise<number> {
    const files: string[] = [];
    await walkFiles(this.workspace, files);

    const folderSet = new Set<string>();
    let indexed = 0;
    for (const relPath of files) {
      if (SKIP_LEGACY_REL_PATHS.has(relPath) || relPath.startsWith("wiki/templates/")) {
        continue;
      }
      try {
        await this.indexFile(userID, relPath, path.join(this.workspace, relPath));
        indexed += 1;
        if (relPath.startsWith("wiki/")) {
          const folder = folderPathFromWikiRelPath(relPath);
          if (folder) folderSet.add(folder);
        }
      } catch (error) {
        console.warn(`Warning: failed to index ${relPath}: ${errorMessage(error)}`);
      }
    }
    if (folderSet.size > 0 && this.store.ensureFolders) {
      try {
        await this.store.ensureFolders([...folderSet]);
      } catch (error) {
        console.warn(`Warning: failed to ensure wiki folders: ${errorMessage(error)}`);
      }
    }

    try {
      await this.rebuildReferences();
    } catch (error) {
      console.warn(`Warning: failed to rebuild references: ${errorMessage(error)}`);
    }

    return indexed;
  }

  private async indexFile(userID: string, relPath: string, fullPath: string): Promise<string> {
    void userID;
    const info = await stat(fullPath);

    let dir = "/";
    let filename = relPath;
    const lastSlash = relPath.lastIndexOf("/");
    if (lastSlash >= 0) {
      dir = `/${relPath.slice(0, lastSlash)}/`;
      filename = relPath.slice(lastSlash + 1);
    }

    const sourceKind = relPath.startsWith("wiki/") ? "wiki" : "source";
    const dot = filename.lastIndexOf(".");
    const ext = dot >= 0 ? filename.slice(dot + 1).toLowerCase() : "";
    let title = titleFromFilename(filename);

    let content = "";
    let contentHash = "";
    if (TEXT_TYPES.has(ext)) {
      const data = await readFile(fullPath);
      content = data.toString("utf8");
      contentHash = createHash("sha256").update(data).digest("hex");
    }

    let tags: string[] = [];
    let date = "";
    let metadata = "";
    let pageType = "";
    if (sourceKind === "wiki" && ext === "md") {
      const frontmatter = parseFrontmatter(content);
      tags = frontmatter.tags;
      date = frontmatter.date;
      metadata = getMetadataJSON(frontmatter);
      if (frontmatter.title) title = frontmatter.title;
      pageType = resolvePageType(frontmatter.type, "", relPath);
    }

    const doc: DocData = {
      id: "",
      filename,
      title,
      path: dir,
      content,
      sourceKind,
      fileType: ext,
      fileSize: info.size,
      status: "ready",
      tags,
      date,
      metadata,
      contentHash,
      pageType,
    };

    const existing = await this.store.getDocumentByPath(filename, dir);
    if (existing) {
      doc.id = existing.id;
      await this.store.updateDocument(existing.id, content, title, tags, date, metadata);
    } else {
      await this.store.createDocument(doc);
    }

    await storeSearchChunks(this.store, doc.id, content);
    return doc.id;
  }

  private async rebuildReferences(): Promise<void> {
    const wikiDocs = await this.store.listWikiDocuments();
    const allDocs = await this.store.listAllDocuments();
    const parser = new ReferenceParser(
      allDocs.map((doc) => ({
        id: doc.id,
        filename: doc.filename,
        title: doc.title,
        path: doc.path,
      })),
    );

    for (const doc of wikiDocs) {
      await this.store.deleteReferences(doc.id);
      const references = parser.parseReferences(doc.content, doc.path + doc.filename);
      const seen = new Set(references.map((ref) => `${ref.targetPath}\0${ref.refType}`));
      for (const reference of references) {
        await this.store.upsertReference(doc.id, reference.targetPath, reference.refType, reference.page);
      }
      const entries = await this.store.listReferenceEntries(doc.id);
      for (const entry of entries) {
        if (!entry.targetDocumentId) continue;
        const key = `${entry.targetDocumentId}\0links_to`;
        if (seen.has(key)) continue;
        seen.add(key);
        await this.store.upsertReference(doc.id, entry.targetDocumentId, "links_to", null);
      }
    }
  }
}

export async function indexDocumentContent(
  store: EngineStore,
  docID: string,
  content: string,
): Promise<void> {
  await storeSearchChunks(store, docID, content);
}

async function storeSearchChunks(store: EngineStore, docID: string, content: string): Promise<void> {
  if (!content.trim()) {
    await store.storeChunks(docID, []);
    return;
  }
  const chunks = chunkText(content, 1, defaultChunkConfig());
  const data: ChunkData[] = chunks.map((chunk) => ({
    documentId: docID,
    chunkIndex: chunk.index,
    content: chunk.content,
    page: chunk.page,
    startChar: chunk.startChar,
    tokenCount: chunk.tokenCount,
    headerBreadcrumb: chunk.headerBreadcrumb,
  }));
  await store.storeChunks(docID, data);
}

async function walkFiles(root: string, output: string[]): Promise<void> {
  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      if (isNotFound(error)) return;
      throw error;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (IGNORE_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
        await walk(path.join(dir, entry.name));
        continue;
      }
      if (entry.name.startsWith(".")) continue;
      output.push(path.relative(root, path.join(dir, entry.name)).split(path.sep).join("/"));
    }
  }
  await walk(root);
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "ENOENT"
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
