import { describe, expect, it } from "vitest";
import {
  PagePlanReviewRequiredError,
  assertBlocksMatchApprovedPlan,
  assertGenerationMatchesPagePlan,
  parseAnalysisPagePlan,
} from "./page_plan.js";

const validPlan = JSON.stringify({
  pages: [
    {
      path: "wiki/产品与项目/llmwiki/Provider协议错配导致401.md",
      action: "create",
      type: "experience",
      title: "Provider协议错配导致401",
      reuse_reason: "相同症状与判别流程可复用",
      relations: [{ target: "wiki/AI与Agent/模型与Provider/MiniMax.md", kind: "involves" }],
    },
  ],
});

describe("analysis page plan", () => {
  it("parses a fenced plan and keeps relations out of pages", () => {
    const plan = parseAnalysisPagePlan(`分析摘要\n\n\`\`\`json\n${validPlan}\n\`\`\``);
    expect(plan.pages).toHaveLength(1);
    expect(plan.pages[0]?.relations).toEqual([
      { target: "wiki/AI与Agent/模型与Provider/MiniMax.md", kind: "involves" },
    ]);
  });

  it("fails empty analysis and creates without a reuse reason", () => {
    expect(() => parseAnalysisPagePlan("  ")).toThrow("analysis is empty");
    expect(() => parseAnalysisPagePlan(JSON.stringify({
      pages: [{ path: "wiki/主题/页面.md", action: "create", type: "concept", title: "页面" }],
    }))).toThrow("reuse_reason");
  });

  it("requires review for more than three business pages or two concepts", () => {
    const pages = [1, 2, 3, 4].map((index) => ({
      path: `wiki/主题/经验${index}.md`,
      action: "create",
      type: "experience",
      title: `经验${index}`,
      reuse_reason: "完整独立经验",
    }));
    expect(() => parseAnalysisPagePlan(JSON.stringify({ pages }))).toThrow(PagePlanReviewRequiredError);

    pages.length = 3;
    for (const page of pages) page.type = "concept";
    expect(() => parseAnalysisPagePlan(JSON.stringify({ pages }))).toThrow(PagePlanReviewRequiredError);
  });

  it("rejects generated paths or types that drift from the plan", () => {
    const plan = parseAnalysisPagePlan(validPlan);
    const valid = new Map([[
      plan.pages[0]!.path,
      "---\ntitle: Provider协议错配导致401\ntype: experience\n---\n# Provider协议错配导致401\n",
    ]]);
    expect(() => assertGenerationMatchesPagePlan(valid, plan)).not.toThrow();

    const wrongPath = new Map([["wiki/concepts/Provider协议错配导致401.md", valid.values().next().value!]]);
    expect(() => assertGenerationMatchesPagePlan(wrongPath, plan)).toThrow("未包含在 page plan");

    const wrongType = new Map([[plan.pages[0]!.path, "---\ntitle: Provider协议错配导致401\ntype: concept\n---\n"]]);
    expect(() => assertGenerationMatchesPagePlan(wrongType, plan)).toThrow("type");
  });

  it("rejects REDACTED entity names and attaches plan to PagePlanReviewRequiredError", () => {
    expect(() => parseAnalysisPagePlan(JSON.stringify({
      pages: [{
        path: "wiki/projects/demo/REDACTED-service.md",
        action: "create",
        type: "entity",
        title: "REDACTED 服务",
        reuse_reason: "独立服务实体",
      }],
    }))).toThrow("REDACTED");

    const pages = [1, 2, 3, 4].map((index) => ({
      path: `wiki/system-network/proxy-dns/exp-${index}.md`,
      action: "create",
      type: "experience",
      title: `经验 ${index}`,
      reuse_reason: "独立可复用经验",
    }));
    let caught: unknown;
    try {
      parseAnalysisPagePlan(JSON.stringify({ pages }));
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(PagePlanReviewRequiredError);
    expect((caught as PagePlanReviewRequiredError).plan.pages).toHaveLength(4);
  });

  it("enforces approved plan paths in assertBlocksMatchApprovedPlan", () => {
    const blocks = new Map([["wiki/system-network/proxy-dns/extra.md", "---\ntitle: Extra\n---\n"]]);
    const approved = JSON.stringify({
      changes: [{ path: "wiki/system-network/proxy-dns/allowed.md", action: "create" }],
    });
    expect(() => assertBlocksMatchApprovedPlan(blocks, approved)).toThrow("未包含在已批准计划中");
  });
});
