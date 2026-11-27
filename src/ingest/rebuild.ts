import { refreshFolderOverviews } from "../engine/folder_overview.js";
import { folderPathFromWikiRelPath } from "../engine/wiki_org.js";
import type { Store } from "../store/interfaces.js";
import { syncDocumentMetaFromContent } from "../store/postgres/doc_meta.js";
import { buildPageChunks, rebuildReferences } from "./dbapply.js";

export async function rebuildDerived(db: Store): Promise<number> {
  const docs = await db.listDocumentsWithContent();
  const wikiPaths: string[] = [];
  for (const doc of docs) {
    syncDocumentMetaFromContent(doc);
    await db.storeChunks(doc.id, buildPageChunks(doc.id, doc.content));
    if (doc.source_kind === "wiki" && doc.relative_path) wikiPaths.push(doc.relative_path);
  }

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
  await rebuildReferences(db, wikiPaths);
  return docs.length;
}
