import { createHash, randomUUID } from "node:crypto";
import { refreshFolderOverviews } from "../engine/folder_overview.js";
import { folderPathFromWikiRelPath } from "../engine/wiki_org.js";
import {
  INDEX_REL_PATH,
  IndexBuilder,
  indexEntriesFromDocuments,
} from "../engine/index_builder.js";
import type { Store } from "../store/interfaces.js";
import type { Document, PageWrite } from "../store/types.js";
import { syncDocumentMetaFromContent } from "../store/postgres/doc_meta.js";
import { buildPageChunks, rebuildReferences } from "./dbapply.js";

function contentHash(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/**
 * Regenerate wiki/index.md from the DB documents (the SSOT). The index page
 * declares itself maintained by `llmwiki reindex`; rebuilding only chunks and
 * references left it stale after manual page writes and merges.
 */
async function rebuildIndexPage(db: Store, docs: Document[]): Promise<void> {
  const entries = indexEntriesFromDocuments(docs);
  const today = new Date().toISOString().slice(0, 10);
  const content = new IndexBuilder("").buildIndexContent(today, entries);
  const existing = await db.getDocumentByRelativePath(INDEX_REL_PATH);
  const document: Document = existing
    ? { ...existing, content, title: "内容目录", page_type: "page" }
    : {
        id: randomUUID(),
        user_id: "default",
        filename: "index.md",
        title: "内容目录",
        path: "/wiki/",
        relative_path: INDEX_REL_PATH,
        source_kind: "wiki",
        file_type: "md",
        file_size: Buffer.byteLength(content, "utf8"),
        document_number: 0,
        status: "ready",
        page_count: 0,
        content,
        tags: [],
        date: today,
        metadata: "{}",
        error_message: "",
        version: 0,
        parser: "",
        content_hash: "",
        stale_since: "",
        highlights: "[]",
        created_at: "",
        updated_at: "",
        page_type: "page",
      };

  document.content = content;
  document.content_hash = contentHash(content);
  document.file_size = Buffer.byteLength(content, "utf8");

  const write: PageWrite = {
    relative_path: INDEX_REL_PATH,
    document,
    operation: existing ? "update" : "create",
    chunks: buildPageChunks(document.id, content),
    refs: [],
  };
  await db.applyChangeSet(
    {
      id: randomUUID(),
      kind: "manual",
      summary: "rebuild wiki/index.md",
      page_count: 1,
      created_at: "",
    },
    [write],
  );
}

export async function rebuildDerived(db: Store): Promise<number> {
  const docs = await db.listDocumentsWithContent();
  const wikiPaths: string[] = [];
  for (const doc of docs) {
    syncDocumentMetaFromContent(doc);
    await db.storeChunks(doc.id, buildPageChunks(doc.id, doc.content));
    if (doc.source_kind === "wiki" && doc.relative_path) wikiPaths.push(doc.relative_path);
  }

  await rebuildIndexPage(db, docs);
  const folderSet = [
    ...new Set(
      docs
        .filter((d) => d.source_kind === "wiki" && !d.archived_at)
        .map((d) => folderPathFromWikiRelPath(d.relative_path))
        .filter(Boolean),
    ),
  ];
  if (folderSet.length > 0) {
    await refreshFolderOverviews(db, folderSet).catch(() => undefined);
  }
  if (!wikiPaths.includes(INDEX_REL_PATH)) wikiPaths.push(INDEX_REL_PATH);
  await rebuildReferences(db, wikiPaths);
  return docs.length;
}
