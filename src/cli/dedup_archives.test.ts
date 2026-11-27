import { describe, expect, it, vi } from "vitest";
import type { Store } from "../store/interfaces.js";
import type { ArchiveFile } from "../store/types.js";
import { applyArchiveDedup, planArchiveDedup, stripDuplicateSuffix } from "./dedup_archives.js";

function archive(id: string, filename: string, sha256: string, jobId = ""): ArchiveFile {
  return {
    id,
    user_id: "default",
    folder_path: "ingest",
    filename,
    title: filename,
    relative_path: `ingest/${filename}`,
    kind: "markdown",
    media_type: "text/markdown",
    size: 10,
    sha256,
    storage_backend: "db",
    storage_key: "",
    origin: "ingest_upload",
    ingest_job_id: jobId,
    created_at: "2026-11-27 00:00:00",
    updated_at: "2026-11-27 00:00:00",
  };
}

describe("dedup_archives", () => {
  it("prefers archive file with linked wiki documents as keeper and strips -N suffix", async () => {
    const f1 = archive("a1", "notes.md", "sha-x");
    const f2 = archive("a2", "notes-2.md", "sha-x", "job-1");
    const mergeDuplicateArchiveFiles = vi.fn(async () => f2);
    const db = {
      listArchiveFiles: async () => [f1, f2],
      listArchiveFileDocuments: async (id: string) => (id === "a2" ? [{ id: "doc-1" }] : []),
      mergeDuplicateArchiveFiles,
    } as unknown as Store;

    const groups = await planArchiveDedup(db);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.keep_id).toBe("a2");
    expect(groups[0]?.drop_ids).toEqual(["a1"]);
    expect(groups[0]?.canonical_filename).toBe("notes.md");

    const applied = await applyArchiveDedup(db, groups);
    expect(applied).toEqual({ merged_groups: 1, removed_files: 1 });
    expect(mergeDuplicateArchiveFiles).toHaveBeenCalledWith("a2", ["a1"], { filename: "notes.md" });
  });

  it("strips duplicate numeric suffix cleanly", () => {
    expect(stripDuplicateSuffix("report-2.md")).toBe("report.md");
    expect(stripDuplicateSuffix("report.md")).toBe("report.md");
  });
});
