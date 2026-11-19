import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { IndexBuilder } from "./index_builder.js";
import { wikiPageTemplateFiles } from "./templates.js";

export const WORKSPACE_DIRS = [
  "wiki",
  "wiki/templates",
  "wiki/entities",
  "wiki/concepts",
  "wiki/sources",
  "wiki/synthesis",
  "wiki/comparisons",
  "wiki/queries",
  "raw/sources",
  "raw/assets",
  "revert",
  ".llmwiki",
  ".llmwiki/cache",
  ".obsidian",
];

const WORKSPACE_LEAF_DIRS = [
  "wiki/entities",
  "wiki/concepts",
  "wiki/sources",
  "wiki/synthesis",
  "wiki/comparisons",
  "wiki/queries",
  "raw/sources",
  "raw/assets",
];

const OBSIDIAN_APP_JSON = `{
  "promptDelete": false,
  "showLineNumber": true,
  "strictLineBreaks": false,
  "showFrontmatter": true,
  "useMarkdownLinks": false
}
`;

const PURPOSE_SCAFFOLD_MD = `---
title: 研究目标
goals: []
key_questions: []
scope: ""
---

# 研究目标

请在此描述你的研究目标、关键问题与范围。

## 目标

- （待填写）

## 关键问题

- （待填写）

## 范围

（待填写）
`;

const OVERVIEW_SCAFFOLD_MD = `---
title: 全局总览
description: 知识库全局总览（自动维护）
---

# 全局总览

## 项目目标

（待填写）

## 当前状态

（待填写）

## 主要主题

（待填写）
`;

export function logScaffoldMD(initDate: string): string {
  return `---
title: 操作日志
---

# 操作日志

## [${initDate}] init | 工作区初始化
`;
}

export function indexScaffoldMD(date: string): string {
  return new IndexBuilder("").buildIndexContent(date, null);
}

export async function writeIfNotExists(target: string, content: string): Promise<void> {
  try {
    await stat(target);
    return;
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
  await writeFile(target, content, "utf8");
}

export async function ensureWorkspaceStructure(workspace: string): Promise<void> {
  for (const dir of WORKSPACE_DIRS) {
    await mkdir(path.join(workspace, dir), { recursive: true });
  }
  for (const dir of WORKSPACE_LEAF_DIRS) {
    await writeIfNotExists(path.join(workspace, dir, ".gitkeep"), "");
  }
}

export async function writeWorkspaceScaffoldsIfMissing(
  workspace: string,
  initDate: string,
): Promise<void> {
  const date = initDate || formatDate(new Date());
  const scaffolds: Record<string, string> = {
    "purpose.md": PURPOSE_SCAFFOLD_MD,
    "wiki/overview.md": OVERVIEW_SCAFFOLD_MD,
    "wiki/log.md": logScaffoldMD(date),
    "wiki/index.md": indexScaffoldMD(date),
  };
  for (const [relPath, content] of Object.entries(scaffolds)) {
    await writeIfNotExists(path.join(workspace, relPath), content);
  }
  for (const [relPath, content] of Object.entries(wikiPageTemplateFiles())) {
    await writeIfNotExists(path.join(workspace, relPath), content);
  }
  await writeIfNotExists(
    path.join(workspace, ".obsidian", "app.json"),
    OBSIDIAN_APP_JSON.trim() + "\n",
  );
}

function formatDate(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "ENOENT"
  );
}
