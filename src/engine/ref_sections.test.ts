import { describe, expect, it } from "vitest";

import { extractTrailingReferences, normalizeWikiContent } from "./ref_sections.js";

const USER_EXAMPLE = `---
title: Adam Foroughi
type: entity
---

# 概述

AppLovin CEO。

## 关键事实

- 领导 AppLovin

## 相关实体/概念

- [[AppLovin]] — 其领导的公司。
- [[Axon 2]] — 核心产品决策。
- [[小团队_AI杠杆模型]] — 其核心理念。
- [[A_Player文化]]
- [[工程师必备工具_ClaudeCode_Cursor]]
- [[Token预算陷阱]] — 其提出的认知概念，强调 token 分配中的隐性浪费。

## 来源

- 20VC 播客访谈（2026-05-27 整理存档）
- [[sources/FounderMode实践案例_AppLovin]]
- [[sources/去管理化实践_AppLovin]]
- 原始内容 [[raw/.../archive-20260530-135247.md]]
- 诊断报告（archive-20260530-171850.md）
`;

describe("extractTrailingReferences", () => {
  it("strips trailing sections and extracts entries with annotations", () => {
    const result = extractTrailingReferences(USER_EXAMPLE);
    expect(result.entries.length).toBe(11);

    const appLovin = result.entries.find((e) => e.rawText === "AppLovin");
    expect(appLovin?.kind).toBe("related");
    expect(appLovin?.annotation).toBe("其领导的公司");

    const token = result.entries.find((e) => e.rawText === "Token预算陷阱");
    expect(token?.annotation).toBe("其提出的认知概念，强调 token 分配中的隐性浪费");

    const free = result.entries.find((e) => e.rawText === "20VC 播客访谈（2026-05-27 整理存档）");
    expect(free?.kind).toBe("source");
    expect(free?.annotation).toBe("");

    const prefix = result.entries.find((e) => e.rawText === "raw/.../archive-20260530-135247.md");
    expect(prefix?.annotation).toBe("原始内容");

    expect(result.content).not.toContain("相关实体/概念");
    expect(result.content).not.toContain("## 来源");
    expect(result.content).not.toContain("[[AppLovin]]");
    expect(result.content).toContain("## 关键事实");
    expect(result.content).toContain("- 领导 AppLovin");
    expect(result.content.trimEnd().endsWith("- 领导 AppLovin")).toBe(true);
  });

  it("is idempotent: second run is a no-op", () => {
    const first = extractTrailingReferences(USER_EXAMPLE);
    const second = extractTrailingReferences(first.content);
    expect(second.entries).toEqual([]);
    expect(second.content).toBe(first.content);
  });

  it("keeps mid-document sections that are not in the trailing group", () => {
    const content = `# 概述

正文。

## 来源

- [[some-source]]

## 关键事实

- 最后的事实
`;
    const result = extractTrailingReferences(content);
    expect(result.entries).toEqual([]);
    expect(result.content).toBe(content);
  });

  it("keeps trailing sections that contain non-bullet prose", () => {
    const content = `# 概述

正文。

## 来源

这段是手写说明，不是 bullet。

- [[some-source]]
`;
    const result = extractTrailingReferences(content);
    expect(result.entries).toEqual([]);
    expect(result.content).toBe(content);
    expect(result.skippedHeadings).toEqual(["来源"]);
  });

  it("handles alias links and english section names", () => {
    const content = `# Overview

Body text.

## Related

- [[AppLovin|the company]] — CEO's company.

## Sources

- [[sources/Podcast]]
`;
    const result = extractTrailingReferences(content);
    expect(result.entries.length).toBe(2);
    expect(result.entries[0]).toMatchObject({
      kind: "related",
      rawText: "AppLovin",
      annotation: "CEO's company",
    });
    expect(result.entries[1]).toMatchObject({ kind: "source", rawText: "sources/Podcast" });
    expect(result.content).toContain("Body text.");
    expect(result.content).not.toContain("Related");
  });

  it("strips a lone trailing 来源 section", () => {
    const content = `# 摘要

内容。

## 来源

- [[a]]
- [[b]]
`;
    const result = extractTrailingReferences(content);
    expect(result.entries.map((e) => e.rawText)).toEqual(["a", "b"]);
    expect(result.content.trimEnd().endsWith("内容。")).toBe(true);
  });
});

describe("normalizeWikiContent", () => {
  it("passes through non-wiki or non-markdown content", () => {
    expect(normalizeWikiContent(USER_EXAMPLE, "source", "md").entries).toEqual([]);
    expect(normalizeWikiContent(USER_EXAMPLE, "wiki", "pdf").entries).toEqual([]);
    expect(normalizeWikiContent(USER_EXAMPLE, "source", "md").content).toBe(USER_EXAMPLE);
  });

  it("normalizes wiki markdown", () => {
    const result = normalizeWikiContent(USER_EXAMPLE, "wiki", "md");
    expect(result.entries.length).toBe(11);
  });
});

describe("extractTrailingReferences: tail chrome", () => {
  it("strips sections followed by a blockquote merge note and keeps the note", () => {
    const content = `# 概述

正文。

## 相关实体/概念

- [[AppLovin]]
- [[小团队_AI杠杆模型]]

## 来源

- 20VC 播客访谈

> 本页面整合了两版源文件，保留旧正文所有要点。
`;
    const result = extractTrailingReferences(content);
    expect(result.entries.map((e) => e.rawText)).toEqual(["AppLovin", "小团队_AI杠杆模型", "20VC 播客访谈"]);
    expect(result.content).not.toContain("## 来源");
    expect(result.content).toContain("> 本页面整合了两版源文件");
    expect(result.content.trimEnd().endsWith("要点。")).toBe(true);
  });

  it("keeps footnote-style source sections in place (body cites them)", () => {
    const content = `# 概述

正文引用[^1]。

## 参考来源

[^1]: 花叔 (2026). 文章。[[sources/some-page]]
`;
    const result = extractTrailingReferences(content);
    expect(result.entries).toEqual([]);
    expect(result.content).toBe(content);
  });
});
