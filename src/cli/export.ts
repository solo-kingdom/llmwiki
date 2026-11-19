import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { openCliStore } from "./workspace.js";

export async function runExport(
  out: string,
  includeRaw: boolean,
  databaseUrl?: string,
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

    let rawCount = 0;
    if (includeRaw) {
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
    if (includeRaw) console.log(`Exported ${rawCount} source file(s)`);
  } finally {
    await store.close();
  }
}
