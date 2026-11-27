import { describe, expect, it, vi } from "vitest";
import type { Store } from "../store/interfaces.js";
import { PagePlanReviewRequiredError } from "./page_plan.js";
import { JobProcessor } from "./processor.js";

describe("JobProcessor review & archive alignment helpers", () => {
  it("auto-creates IngestReview when PagePlanReviewRequiredError carries a plan", async () => {
    const createIngestReview = vi.fn(async (r) => {
      r.id = "rev-1";
      return r;
    });
    const createIngestReviewPlan = vi.fn(async (p) => p);
    const db = {
      createIngestReview,
      createIngestReviewPlan,
    } as unknown as Store;

    const processor = new JobProcessor(db, "/tmp/unused");
    const err = new PagePlanReviewRequiredError("too many pages", {
      summary: "拆分 4 个经验页",
      pages: [
        {
          path: "wiki/system-network/proxy-dns/a.md",
          action: "create",
          type: "experience",
          title: "A",
          reuse_reason: "reason",
        },
      ],
    });
    const reviewId = await (
      processor as unknown as {
        createAutoReviewFromPlan: (
          job: { id: string; source_kind: string; source_ref: string; source_path: string; original_name: string; archive_file_id: string },
          plan: NonNullable<PagePlanReviewRequiredError["plan"]>,
        ) => Promise<string>;
      }
    ).createAutoReviewFromPlan(
      {
        id: "job-1",
        source_kind: "markdown",
        source_ref: "source.md",
        source_path: "/tmp/source.md",
        original_name: "source.md",
        archive_file_id: "arch-1",
      },
      err.plan!,
    );

    expect(reviewId).toBe("rev-1");
    expect(createIngestReview).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "rev-1",
        archive_file_id: "arch-1",
        status: "ready_for_review",
      }),
    );
    expect(createIngestReviewPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        review_id: "rev-1",
        version: 1,
      }),
    );
  });

  it("aligns archive file folder from ingest/ to target topic folder on finalizeWikiApply", async () => {
    const updateArchiveFileLocation = vi.fn(async () => undefined);
    const updateArchiveFolder = vi.fn(async () => undefined);
    const db = {
      listFolders: async () => [],
      listDocumentsWithContent: async () => [],
      getDocumentByRelativePath: async () => null,
      getIngestJob: async () => ({ id: "job-2", archive_file_id: "arch-2" }),
      getArchiveFile: async () => ({
        id: "arch-2",
        folder_path: "ingest/2026-11",
        filename: "dns.md",
      }),
      updateArchiveFileLocation,
      getFolder: async () => ({
        path: "system-network/proxy-dns",
        display_name: "代理与 DNS",
        description: "DNS 解析",
        sort_order: 1,
      }),
      updateArchiveFolder,
      listDocumentsFiltered: async () => [],
      applyChangeSet: async () => undefined,
      getConfig: async () => "",
      insertIngestJobEvent: async () => undefined,
    } as unknown as Store;

    const processor = new JobProcessor(db, "/tmp/unused");
    await (
      processor as unknown as {
        finalizeWikiApply: (
          jobId: string,
          archivePath: string,
          planJson: string,
          result: { written: string[]; deleted: string[] },
        ) => Promise<void>;
      }
    ).finalizeWikiApply("job-2", "", "", { written: ["wiki/system-network/proxy-dns/dns.md"], deleted: [] });

    expect(updateArchiveFileLocation).toHaveBeenCalledWith(
      "arch-2",
      "system-network/proxy-dns",
      "dns.md",
    );
    expect(updateArchiveFolder).toHaveBeenCalledWith(
      "system-network/proxy-dns",
      expect.objectContaining({ display_name: "代理与 DNS", description: "DNS 解析" }),
    );
  });
});
