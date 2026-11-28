import { describe, expect, it } from "vitest";
import { extractJsonCandidates, parseJsonWithRepair, repairJsonText } from "./json_repair.js";

describe("json_repair", () => {
  it("repairs unescaped ASCII double quotes inside summary (real invalid_page_plan case)", () => {
    const broken = `\`\`\`json
{
  "summary": "记录了 "wiki 页面写入探针的清理顺序" 相关的排查经验与边界约束。",
  "pages": [
    {
      "path": "wiki/system-network/reverse-proxy-diagnostics/probe-cleanup-order.md",
      "action": "create",
      "type": "experience",
      "title": "Wiki 页面写入探针清理顺序",
      "reuse_reason": "同类型排查可复用",
      "relations": []
    }
  ]
}
\`\`\``;

    const result = parseJsonWithRepair<{ summary: string; pages: Array<{ path: string }> }>(broken);
    expect(result).not.toBeNull();
    expect(result?.repaired).toBe(true);
    expect(result?.value.summary).toContain('"wiki 页面写入探针的清理顺序"');
    expect(result?.value.pages).toHaveLength(1);
  });

  it("repairs multiple unescaped quotes including comma-separated quoted phrases", () => {
    const broken = `{
  "summary": "对比 "方案A", "方案B" 两种方案并说明 "超长文本" 的失败边界",
  "pages": [
    {
      "path": "wiki/engineering-delivery/diagnostics/compare-ab.md",
      "action": "create",
      "type": "experience",
      "title": "方案对比",
      "reuse_reason": "包含 "A" 与 "B" 的复用经验"
    }
  ],
}`;

    const result = parseJsonWithRepair<{ summary: string; pages: Array<{ reuse_reason: string }> }>(broken);
    expect(result).not.toBeNull();
    expect(result?.repaired).toBe(true);
    expect(result?.value.summary).toBe('对比 "方案A", "方案B" 两种方案并说明 "超长文本" 的失败边界');
    expect(result?.value.pages[0]?.reuse_reason).toBe('包含 "A" 与 "B" 的复用经验');
  });

  it("repairs raw newlines inside strings and trailing commas", () => {
    const broken = `{
  "summary": "第一行说明
第二行说明",
  "pages": [
    {
      "path": "wiki/engineering-delivery/diagnostics/raw-newline.md",
      "action": "create",
      "type": "experience",
      "title": "换行测试",
      "reuse_reason": "可复用",
    },
  ],
}`;
    const repaired = repairJsonText(broken);
    const parsed = JSON.parse(repaired) as { summary: string; pages: unknown[] };
    expect(parsed.summary).toBe("第一行说明\n第二行说明");
    expect(parsed.pages).toHaveLength(1);
  });

  it("prioritizes the later json plan block over earlier non-json diagnostic code fences", () => {
    const raw = [
      "先看报错日志：",
      "```bash",
      'curl -s http://127.0.0.1:8080/health # "ok"',
      "```",
      "",
      "分析结果如下（约 2.8KB 长文）：",
      "x".repeat(2800),
      "",
      "```json",
      JSON.stringify({
        summary: "长文分析完成",
        pages: [{
          path: "wiki/data-ads/data-pipelines/long-doc.md",
          action: "create",
          type: "experience",
          title: "长文摄入经验",
          reuse_reason: "完整复现与边界",
        }],
      }),
      "```",
    ].join("\n");

    const candidates = extractJsonCandidates(raw);
    expect(candidates.length).toBeGreaterThanOrEqual(2);
    const result = parseJsonWithRepair<{ pages: Array<{ path: string }> }>(
      raw,
      (v) => Boolean(v && typeof v === "object" && "pages" in v),
    );
    expect(result?.repaired).toBe(false);
    expect(result?.value.pages[0]?.path).toBe("wiki/data-ads/data-pipelines/long-doc.md");
  });

  it("keeps valid JSON untouched with repaired=false", () => {
    const valid = JSON.stringify({ summary: "ok", pages: [{ path: "a" }] });
    const result = parseJsonWithRepair(valid);
    expect(result).not.toBeNull();
    expect(result?.repaired).toBe(false);
    expect(result?.json).toBe(valid);
  });
});
