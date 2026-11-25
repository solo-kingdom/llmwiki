import { describe, expect, it } from "vitest";
import {
  appendArchiveHistoryEntry,
  getMetadataJSON,
  getTagsString,
  isValidIsoDate,
  parseFrontmatter,
  titleFromFilename,
  upsertFrontmatterFields,
  upsertFrontmatterType,
  validateFrontmatter,
} from "./frontmatter.js";

describe("frontmatter", () => {
  it("parses YAML frontmatter including wiki-data metadata fields", () => {
    const fm = parseFrontmatter(
      [
        "---",
        "title: PG 连接池耗尽",
        "type: experience",
        "kind: pitfall",
        "status: validated",
        "confidence: high",
        "date: 2026-11-24",
        "last_verified: 2026-11-24",
        "review_after: 2027-02-24",
        "aliases: [pg-pool-exhausted]",
        "symptoms: [too many clients already, connection timeout]",
        "sources: [incident-101.md]",
        "related: [db-pool-pattern]",
        "tags:",
        "  - postgres",
        "description: 连接泄漏导致连接池耗尽",
        "---",
        "",
        "Body",
      ].join("\n"),
    );
    expect(fm.title).toBe("PG 连接池耗尽");
    expect(fm.type).toBe("experience");
    expect(fm.kind).toBe("pitfall");
    expect(fm.status).toBe("validated");
    expect(fm.confidence).toBe("high");
    expect(fm.date).toBe("2026-11-24");
    expect(fm.last_verified).toBe("2026-11-24");
    expect(fm.review_after).toBe("2027-02-24");
    expect(fm.aliases).toEqual(["pg-pool-exhausted"]);
    expect(fm.symptoms).toEqual(["too many clients already", "connection timeout"]);
    expect(fm.sources).toEqual(["incident-101.md"]);
    expect(fm.related).toEqual(["db-pool-pattern"]);
    expect(fm.tags).toEqual(["postgres"]);
    expect(fm.description).toBe("连接泄漏导致连接池耗尽");
    expect(fm.parse_errors).toBeUndefined();
  });

  it("returns empty metadata when frontmatter is absent", () => {
    expect(parseFrontmatter("# Just a heading")).toMatchObject({
      title: "",
      description: "",
      date: "",
      type: "",
      tags: [],
      confidence: "",
      status: "",
      kind: "",
      aliases: [],
      symptoms: [],
    });
  });

  it("records parse_errors for invalid YAML or non-array list fields", () => {
    const fm = parseFrontmatter("---\n: : :\n---\nBody");
    expect(fm.title).toBe("");
    expect(fm.parse_errors?.length).toBeGreaterThan(0);

    const fm2 = parseFrontmatter("---\ntitle: A\ntags: not-a-list\n---\nBody");
    expect(fm2.parse_errors).toContain("tags 必须是列表");
  });

  it("serializes tags and description safely", () => {
    const fm = { title: "T", description: "D", date: "", type: "", tags: ["a", "b"] };
    expect(getTagsString(fm)).toBe('["a","b"]');
    expect(getMetadataJSON(fm)).toBe('{"description":"D"}');
    expect(getMetadataJSON({ ...fm, description: "" })).toBe("{}");
  });

  it("validates ISO calendar dates strictly", () => {
    expect(isValidIsoDate("2026-11-25")).toBe(true);
    expect(isValidIsoDate("2026-02-30")).toBe(false);
    expect(isValidIsoDate("2026-13-01")).toBe(false);
    expect(isValidIsoDate("2026/11/25")).toBe(false);
  });

  it("derives titles from filenames", () => {
    expect(titleFromFilename("attention-is-all-you-need.md")).toBe("Attention Is All You Need");
    expect(titleFromFilename("wiki_org.md")).toBe("Wiki Org");
    expect(titleFromFilename("README")).toBe("README");
  });

  it("validates frontmatter type without locking to directory name (except sources/)", () => {
    const fm = { title: "Harness", description: "", date: "2026-11-24", type: "experience", tags: [] };
    expect(validateFrontmatter("wiki/AI工程/Agent/harness.md", fm, "AI工程")).toEqual([]);
    expect(validateFrontmatter("wiki/sources/src.md", fm, "sources")).toHaveLength(1);

    const updated = upsertFrontmatterType("---\ntitle: A\ntype: page\n---\n\nBody", "concept");
    expect(updated).toContain("type: concept");
    const added = upsertFrontmatterType("# Title\n\nBody", "entity");
    expect(added.startsWith("---\ntype: entity\n---\n")).toBe(true);
  });

  it("upserts/removes frontmatter fields and appends archive history cleanly", () => {
    const raw = "---\ntitle: A\ntype: experience\narchived_at: 2026-11-20\narchive_reason: obsolete\n---\n\n# 适用场景\n\n内容\n";
    const reopened = upsertFrontmatterFields(
      raw,
      { confidence: "high", last_verified: "2026-11-25", date: "2026-11-25" },
      ["archived_at", "archive_reason", "superseded_by"],
    );
    const parsed = parseFrontmatter(reopened);
    expect(parsed.archived_at).toBe("");
    expect(parsed.archive_reason).toBe("");
    expect(parsed.confidence).toBe("high");
    expect(parsed.last_verified).toBe("2026-11-25");

    const withHistory = appendArchiveHistoryEntry(reopened, "- [2026-11-25] 重开：重新核实");
    expect(withHistory).toContain("## 归档与重开记录");
    expect(withHistory).toContain("- [2026-11-25] 重开：重新核实");
    const withSecond = appendArchiveHistoryEntry(withHistory, "- [2026-11-26] 归档：被替代");
    expect(withSecond.match(/## 归档与重开记录/g)).toHaveLength(1);
    expect(withSecond).toContain("- [2026-11-26] 归档：被替代");
  });
});
