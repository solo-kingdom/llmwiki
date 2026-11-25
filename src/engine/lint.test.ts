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
