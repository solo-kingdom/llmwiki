import { describe, expect, it } from "vitest";
import { extractLinkTargets, lintPages, resolveWikiTarget, type LintPageInput } from "./lint.js";
import {
  LINT_CODE_AMBIGUOUS_LINK,
  LINT_CODE_ARCHIVE_METADATA_INVALID,
  LINT_CODE_ARCHIVED_REFERENCE,
  LINT_CODE_CONFIDENCE_INVALID,
  LINT_CODE_CONFIDENCE_MISSING,
  LINT_CODE_DATE_INVALID,
  LINT_CODE_EXPERIENCE_STATUS_INVALID,
  LINT_CODE_KIND_INVALID,
  LINT_CODE_MISSING_FRONTMATTER,
  LINT_CODE_ORPHAN_PAGE,
  LINT_CODE_PATTERN_INSTANCES_INSUFFICIENT,
  LINT_CODE_REVIEW_OVERDUE,
  LINT_CODE_SYMPTOMS_MISSING,
  LINT_CODE_VERIFICATION_MISSING,
} from "./lint_types.js";

const linkIndex = new Map<string, string>([
  ["wiki/entities/adam_foroughi.md", "wiki/entities/Adam_Foroughi.md"],
  ["wiki/entities/adam_foroughi", "wiki/entities/Adam_Foroughi.md"],
  ["adam_foroughi", "wiki/entities/Adam_Foroughi.md"],
  ["wiki/concepts/a_player文化.md", "wiki/concepts/A_Player文化.md"],
  ["wiki/concepts/a_player文化", "wiki/concepts/A_Player文化.md"],
  ["a_player文化", "wiki/concepts/A_Player文化.md"],
]);

describe("lint link targets", () => {
  it("strips the escaped pipe from generated index links", () => {
    expect(
      extractLinkTargets("[[entities/Adam_Foroughi\\|Adam Foroughi]]", "wiki/index.md"),
    ).toEqual(["entities/Adam_Foroughi"]);
  });

  it("resolves space/underscore variants to the canonical page path", () => {
    expect(resolveWikiTarget(linkIndex, "Adam Foroughi")).toBe("wiki/entities/Adam_Foroughi.md");
    expect(resolveWikiTarget(linkIndex, "entities/Adam Foroughi")).toBe("wiki/entities/Adam_Foroughi.md");
    expect(resolveWikiTarget(linkIndex, "concepts/A Player文化")).toBe("wiki/concepts/A_Player文化.md");
  });
});

function page(relPath: string, content: string, extra: Partial<LintPageInput> = {}): LintPageInput {
  const subdir = relPath.split("/")[1] ?? "";
  return {
    relPath,
    absPath: relPath,
    subdir,
    inTypedSubdir: true,
    isSystem: false,
    isMisplaced: false,
    content,
    ...extra,
  };
}

describe("lintPages wiki-data rules", () => {
  it("detects confidence, verification, date, kind, and experience status errors", () => {
    const pages: LintPageInput[] = [
      page(
        "wiki/experiences/bad-exp.md",
        [
          "---",
          "title: Bad Exp",
          "type: experience",
          "kind: unknown",
          "status: broken",
          "confidence: super",
          "date: 2026-02-30",
          "---",
          "Body",
        ].join("\n"),
      ),
      page(
        "wiki/experiences/high-unverified.md",
        [
          "---",
          "title: High Unverified",
          "type: experience",
          "kind: pitfall",
          "status: validated",
          "confidence: high",
          "date: 2026-11-20",
          "---",
          "Body",
        ].join("\n"),
      ),
      page(
        "wiki/ledgers/missing-status.md",
        ["---", "title: Ledger No Status", "type: ledger", "confidence: medium", "date: 2026-11-20", "---", "Body"].join(
          "\n",
        ),
      ),
    ];

    const report = lintPages(pages, { today: "2026-11-25" });
    const codes = report.issues.map((i) => i.code);
    expect(codes).toContain(LINT_CODE_KIND_INVALID);
    expect(codes).toContain(LINT_CODE_EXPERIENCE_STATUS_INVALID);
    expect(codes).toContain(LINT_CODE_CONFIDENCE_INVALID);
    expect(codes).toContain(LINT_CODE_DATE_INVALID);
    expect(codes).toContain(LINT_CODE_VERIFICATION_MISSING);
    expect(codes).toContain(LINT_CODE_MISSING_FRONTMATTER);
    expect(codes).toContain(LINT_CODE_SYMPTOMS_MISSING);
  });

  it("treats legacy pages missing confidence as warning (not error) and checks overdue/pattern/archive", () => {
    const pages: LintPageInput[] = [
      page(
        "wiki/concepts/legacy.md",
        ["---", "title: Legacy", "type: concept", "date: 2026-10-01", "description: legacy", "---", "[[pitfall-1]] [[old]]"].join("\n"),
        {
          referenceEntries: [
            {
              kind: "source",
              rawText: "src.md",
              targetDocumentId: "s1",
              annotation: "",
              position: 0,
              targetTitle: "Src",
              targetPath: "/wiki/sources/",
              targetFilename: "src.md",
            },
          ],
        },
      ),
      page(
        "wiki/experiences/pitfall-1.md",
        [
          "---",
          "title: Pitfall 1",
          "type: experience",
          "kind: pitfall",
          "status: validated",
          "confidence: high",
          "date: 2026-11-01",
          "last_verified: 2026-11-01",
          "review_after: 2026-11-10",
          "symptoms: [timeout]",
          "sources: [src.md]",
          "description: d",
          "---",
          "Body",
        ].join("\n"),
      ),
      page(
        "wiki/experiences/pattern-1.md",
        [
          "---",
          "title: Pattern 1",
          "type: experience",
          "kind: pattern",
          "status: draft",
          "confidence: medium",
          "date: 2026-11-20",
          "symptoms: [timeout]",
          "related: [pitfall-1]",
          "sources: [src.md]",
          "description: d",
          "---",
          "Body",
        ].join("\n"),
      ),
      page(
        "wiki/concepts/old.md",
        [
          "---",
          "title: Old",
          "type: concept",
          "confidence: medium",
          "date: 2026-11-01",
          "archived_at: 2026-11-15",
          "archive_reason: superseded",
          "sources: [src.md]",
          "description: old",
          "---",
          "[[orphan-target]]",
        ].join("\n"),
      ),
      page(
        "wiki/concepts/orphan-target.md",
        [
          "---",
          "title: Orphan Target",
          "type: concept",
          "confidence: medium",
          "date: 2026-11-01",
          "sources: [src.md]",
          "description: only linked from archived",
          "---",
          "Body",
        ].join("\n"),
      ),
      page(
        "wiki/sources/src.md",
        [
          "---",
          "title: Src",
          "type: source",
          "confidence: high",
          "last_verified: 2026-11-01",
          "origin: user-input",
          "captured_at: 2026-11-01",
          "date: 2026-11-01",
          "description: src",
          "---",
          "Summary",
        ].join("\n"),
      ),
    ];

    const report = lintPages(pages, { today: "2026-11-25" });
    const errors = report.issues.filter((i) => i.severity === "error");
    expect(errors).toEqual([]);

    const warnings = report.issues.filter((i) => i.severity === "warning");
    expect(warnings.some((w) => w.code === LINT_CODE_CONFIDENCE_MISSING && w.path === "wiki/concepts/legacy.md")).toBe(
      true,
    );
    expect(warnings.some((w) => w.code === LINT_CODE_REVIEW_OVERDUE && w.path === "wiki/experiences/pitfall-1.md")).toBe(
      true,
    );
    expect(
      warnings.some(
        (w) => w.code === LINT_CODE_PATTERN_INSTANCES_INSUFFICIENT && w.path === "wiki/experiences/pattern-1.md",
      ),
    ).toBe(true);
    expect(warnings.some((w) => w.code === LINT_CODE_ARCHIVED_REFERENCE && w.path === "wiki/concepts/legacy.md")).toBe(
      true,
    );
    expect(warnings.some((w) => w.code === LINT_CODE_ORPHAN_PAGE && w.path === "wiki/concepts/orphan-target.md")).toBe(
      true,
    );

    expect(report.stats).toMatchObject({
      active: 5,
      archived: 1,
      draft: 1,
      validated: 1,
      deprecated: 0,
      review_overdue: 1,
    });
  });

  it("detects archive metadata errors and ambiguous links", () => {
    const pages: LintPageInput[] = [
      page(
        "wiki/A/dup.md",
        ["---", "title: Same", "type: concept", "confidence: medium", "date: 2026-11-20", "archive_reason: no-date", "---", "[[Same]]"].join(
          "\n",
        ),
      ),
      page(
        "wiki/B/dup.md",
        ["---", "title: Same", "type: concept", "confidence: medium", "date: 2026-11-20", "---", "Body"].join("\n"),
      ),
    ];
    const report = lintPages(pages, { today: "2026-11-25" });
    expect(report.issues.some((i) => i.code === LINT_CODE_ARCHIVE_METADATA_INVALID)).toBe(true);
    expect(report.issues.some((i) => i.code === LINT_CODE_AMBIGUOUS_LINK)).toBe(true);
  });
});


describe("lintPages pyramid structure", () => {
  it("detects global title, filename and alias duplicates across folders", () => {
    const pages = [
      page("wiki/A/组/MiniMax.md", "---\ntitle: MiniMax\ntype: entity\n---\n# MiniMax\n"),
      page("wiki/B/组/mini_max.md", "---\ntitle: 另一个对象\ntype: entity\naliases: [Mini Max]\n---\n# 另一个对象\n"),
    ];
    const report = lintPages(pages);
    const issues = report.issues.filter((issue) => issue.code === "global_duplicate_page");
    expect(issues).toHaveLength(2);
    expect(issues.every((issue) => issue.severity === "error")).toBe(true);
  });

  it("checks legacy roots, folder metadata, fanout and unapproved third-level folders", () => {
    const pages = [
      page("wiki/concepts/旧页面.md", "---\ntitle: 旧页面\ntype: concept\n---\n# 旧页面\n"),
      page("wiki/系统与网络/代理与DNS/子组/页面.md", "---\ntitle: 页面\ntype: concept\n---\n# 页面\n"),
    ];
    const report = lintPages(pages, {
      structurePolicyMode: "enforce",
      folders: [
        { path: "系统与网络", display_name: "", description: "", sort_order: 0, created_at: "", updated_at: "", direct_count: 0, total_count: 1 },
        { path: "系统与网络/代理与DNS", display_name: "代理与 DNS", description: "边界", sort_order: 0, created_at: "", updated_at: "", direct_count: 0, total_count: 1 },
        { path: "系统与网络/代理与DNS/子组", display_name: "子组", description: "边界", sort_order: 0, created_at: "", updated_at: "", direct_count: 1, total_count: 1 },
      ],
    });
    expect(report.issues.some((issue) => issue.code === "legacy_type_root" && issue.severity === "error")).toBe(true);
    expect(report.issues.some((issue) => issue.code === "folder_metadata_missing")).toBe(true);
    expect(report.issues.some((issue) => issue.code === "topic_depth_exceeded")).toBe(true);
    expect(report.issues.some((issue) => issue.code === "folder_fanout")).toBe(true);
  });

  it("checks canonical filenames, title/H1 parity and experience-shaped concepts", () => {
    const report = lintPages([
      page(
        "wiki/产品与项目/llmwiki/Provider_协议.md",
        "---\ntitle: Provider 协议\ntype: concept\n---\n# 不同标题\n\n## 症状\nA\n## 最短判别\nB\n## 根因\nC\n## 验证\nD\n",
      ),
    ]);
    expect(report.issues.some((issue) => issue.code === "filename_noncanonical")).toBe(true);
    expect(report.issues.some((issue) => issue.code === "experience_shape_mismatch")).toBe(true);
  });

  it("allows mixed page types in one topic group", () => {
    const report = lintPages([
      page("wiki/A/组/对象.md", "---\ntitle: 对象\ntype: entity\n---\n# 对象\n"),
      page("wiki/A/组/机制.md", "---\ntitle: 机制\ntype: concept\n---\n# 机制\n"),
      page("wiki/A/组/故障.md", "---\ntitle: 故障\ntype: experience\n---\n# 故障\n"),
    ]);
    expect(report.issues.some((issue) => issue.message.includes("混有"))).toBe(false);
  });
});
