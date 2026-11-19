import type { Store } from "../store/interfaces.js";
import { buildPageChunks, rebuildReferences } from "./dbapply.js";

export async function rebuildDerived(db: Store): Promise<number> {
  const docs = await db.listDocumentsWithContent();
  const wikiPaths: string[] = [];
  for (const doc of docs) {
    await db.storeChunks(doc.id, buildPageChunks(doc.id, doc.content));
    if (doc.source_kind === "wiki" && doc.relative_path) wikiPaths.push(doc.relative_path);
  }
  await rebuildReferences(db, wikiPaths);
  return docs.length;
}
