import { readFile } from "node:fs/promises";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { Client } from "../llm/client.js";
import { diffMergeBody } from "./diff_merge.js";
import { composeSystemPrompt } from "./prompts.js";
import type { MergeContext } from "./types.js";
import { recordLLMRequest, recordLLMResponse, traceRetries } from "./job_events.js";

const MERGE_MIN_BODY_RATIO = 0.7;
const WIKI_FRONTMATTER_RE = /^---[ \t]*\n([\s\S]+?\n)---[ \t]*\n([\s\S]*)$/;

const LOCKED_FRONTMATTER_KEYS = [
  "type",
  "title",
  "created",
  "origin",
  "captured_at",
  "archived_at",
  "archive_reason",
  "superseded_by",
];
const UNION_FRONTMATTER_KEYS = ["tags", "aliases", "sources", "related", "symptoms"];
const PREFER_NEW_IF_SET_KEYS = [
  "date",
  "description",
  "confidence",
  "status",
  "kind",
  "last_verified",
  "review_after",
];

function splitWikiPage(content: string): { frontmatter: string; body: string; hasFrontmatter: boolean } {
  const match = WIKI_FRONTMATTER_RE.exec(content);
  if (!match) return { frontmatter: "", body: content, hasFrontmatter: false };
  return { frontmatter: match[1] ?? "", body: match[2] ?? "", hasFrontmatter: true };
}

function joinWikiPage(frontmatter: string, body: string): string {
  if (!frontmatter) return body;
  return `---\n${frontmatter.replace(/\n$/, "")}\n---\n${body}`;
}

function parseYamlMap(text: string): Record<string, unknown> {
  const trimmed = text.trim();
  if (!trimmed) return {};
  try {
    const parsed = parseYaml(trimmed);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function marshalYamlMap(value: Record<string, unknown>): string {
  if (Object.keys(value).length === 0) return "";
  return stringifyYaml(value);
}

function isEmptyYamlValue(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function stringSliceFromYaml(value: unknown): string[] {
  if (value == null) return [];
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string" && item.trim() !== "");
  }
  if (typeof value === "string" && value.trim() !== "") return [value];
  return [];
}

function unionStringSlices(a: string[], b: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const slice of [a, b]) {
    for (const raw of slice) {
      const value = raw.trim();
      if (!value || seen.has(value)) continue;
      seen.add(value);
      out.push(value);
    }
  }
  return out;
}

export function mergeFrontmatter(oldYaml: string, newYaml: string): string {
  const oldMap = parseYamlMap(oldYaml);
  const newMap = parseYamlMap(newYaml);
  const out: Record<string, unknown> = { ...oldMap, ...newMap };

  for (const key of LOCKED_FRONTMATTER_KEYS) {
    const value = oldMap[key];
    if (key in oldMap && !isEmptyYamlValue(value)) out[key] = value;
  }
  for (const key of UNION_FRONTMATTER_KEYS) {
    out[key] = unionStringSlices(stringSliceFromYaml(oldMap[key]), stringSliceFromYaml(newMap[key]));
  }
  for (const key of PREFER_NEW_IF_SET_KEYS) {
    if (key in newMap && !isEmptyYamlValue(newMap[key])) {
      out[key] = newMap[key];
    } else if (key in oldMap) {
      out[key] = oldMap[key];
    }
  }
  return marshalYamlMap(out);
}

function runeLength(value: string): number {
  return [...value].length;
}

export async function mergeBodyLLM(
  llmClient: Client | null,
  docLang: string,
  recorder: MergeContext["recorder"],
  oldBody: string,
  newBody: string,
): Promise<string> {
  if (!llmClient) throw new Error("LLM client not configured for body merge");
  if (oldBody === newBody) return oldBody;

  const oldLen = runeLength(oldBody);
  const systemMessage = composeSystemPrompt("merge_body", {
    workspace: "",
    docLang,
    rulesSupplement: "",
  });
  const userMessage =
    `合并以下 wiki 页面正文，保留旧内容所有重要信息，整合新内容增量。\n` +
    `仅输出完整 markdown 正文（不含 frontmatter）。\n` +
    `旧内容长度: ${oldLen} 字符。合并结果不得少于旧内容的 70%。\n\n` +
    `## 旧正文\n\n${oldBody}\n\n## 新正文\n\n${newBody}`;
  const messages = [
    { role: "system", content: systemMessage },
    { role: "user", content: userMessage },
  ];
  const temperature = 0.1;
  const maxTokens = 8192;
  recordLLMRequest(recorder, "merge_body", llmClient.model, messages, temperature, maxTokens);
  const stopTrace = traceRetries(llmClient, recorder, "merge_body");

  let result = "";
  try {
    const chunks: string[] = [];
    for await (const event of llmClient.streamChat(messages, temperature, maxTokens)) {
      if (event.type === "token") chunks.push(event.content ?? "");
      if (event.type === "error" && event.error) throw event.error;
    }
    result = chunks.join("").trim();
  } finally {
    stopTrace();
  }
  recordLLMResponse(recorder, "merge_body", result, 0);

  if (oldLen > 0) {
    const mergedLen = runeLength(result);
    const minLen = Math.floor(oldLen * MERGE_MIN_BODY_RATIO);
    if (mergedLen < minLen) {
      throw new Error(
        `merge body too aggressive: merged ${mergedLen} chars < 70% of old ${oldLen} chars`,
      );
    }
  }
  return result;
}

/** Returns null when the write should be skipped. */
export async function mergeWikiPage(
  fullPath: string,
  newContent: string,
  context: MergeContext,
): Promise<string | null> {
  let oldContent: string;
  try {
    oldContent = await readFile(fullPath, "utf8");
  } catch (error) {
    if (isNotFound(error)) return newContent;
    throw error;
  }

  if (oldContent === newContent) return null;

  const oldPage = splitWikiPage(oldContent);
  const newPage = splitWikiPage(newContent);

  if (!oldPage.hasFrontmatter && !newPage.hasFrontmatter) {
    if (oldPage.body === newPage.body) return null;
    return diffMergeBody(context, oldPage.body, newPage.body);
  }

  const mergedFrontmatter = mergeFrontmatter(oldPage.frontmatter, newPage.frontmatter);
  let mergedBody = oldPage.body;
  if (oldPage.body !== newPage.body) {
    mergedBody = await diffMergeBody(context, oldPage.body, newPage.body);
  }
  return joinWikiPage(mergedFrontmatter, mergedBody);
}

export { splitWikiPage, joinWikiPage, MERGE_MIN_BODY_RATIO };

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "ENOENT"
  );
}
