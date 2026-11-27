import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { ArchiveStorageService } from "../archive/storage.js";
import { INDEX_REL_PATH, IndexBuilder, indexEntriesFromDocuments } from "../engine/index_builder.js";
import { openCliStore } from "./workspace.js";

export async function runExport(
  out: string,
  includeRaw: boolean,
  databaseUrl?: string,
  withIndex = false,
): Promise<void> {
  if (!out) throw new Error("--out is required");
  const store = await openCliStore(databaseUrl);
  try {
    const docs = await store.listDocumentsWithContent();
    let written = 0;
    for (const doc of docs) {
      const rel = doc.relative_path;
      if (!rel) continue;
      const full = path.join(out, rel);
      await mkdir(path.dirname(full), { recursive: true, mode: 0o755 });
      await writeFile(full, doc.content, "utf8");
      written += 1;
    }

    if (withIndex) {
      const entries = indexEntriesFromDocuments(docs);
      const today = new Date().toISOString().slice(0, 10);
      const indexContent = new IndexBuilder().buildIndexContent(today, entries);
      const full = path.join(out, INDEX_REL_PATH);
      await mkdir(path.dirname(full), { recursive: true, mode: 0o755 });
      await writeFile(full, indexContent, "utf8");
    }

    let rawCount = 0;
    if (includeRaw) {
      const archiveStorage = new ArchiveStorageService(store, "");
      const archiveFiles = await store.listArchiveFiles();
      for (const file of archiveFiles) {
        const bytes = await archiveStorage.readFullBytes(file);
        const rel = file.relative_path.replace(/^\/+/, "");
        const full = path.join(out, "archives", rel);
        await mkdir(path.dirname(full), { recursive: true, mode: 0o755 });
        await writeFile(full, bytes);
        rawCount += 1;
      }

      const blobs = await store.listSourceBlobs();
      for (const blob of blobs) {
        const found = await store.getSourceBlob(blob.id);
        if (!found) continue;
        const full = path.join(out, "raw", "sources", path.basename(blob.filename));
        await mkdir(path.dirname(full), { recursive: true, mode: 0o755 });
        await writeFile(full, found.data);
        rawCount += 1;
      }
    }

    console.log(`Exported ${written} page(s) to ${out}`);
    if (withIndex) console.log(`Generated ${INDEX_REL_PATH}`);
    if (includeRaw) console.log(`Exported ${rawCount} source file(s)`);
  } finally {
    await store.close();
  }
}
