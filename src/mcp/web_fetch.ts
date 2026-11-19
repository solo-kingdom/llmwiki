import { mkdir, rename, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import type { Tool } from "./types.js";

const WEB_FETCH_MAX_URLS = 5;
const WEB_FETCH_TIMEOUT_MS = 15000;
const WEB_FETCH_MAX_REDIRECTS = 5;
const WEB_FETCH_MAX_BODY_SIZE = 2 * 1024 * 1024;
const WEB_FETCH_MAX_RESULT_SIZE = 50 * 1024;
const WEB_FETCH_MAX_TOTAL_SIZE = 200 * 1024;
const WEB_FETCH_BASE_DIR = "raw/sources/web-fetch";

export const webFetchTool: Tool = {
  name: "web_fetch",
  description:
    "Fetch and extract content from web pages. Returns readable Markdown text from the given URLs. Use this when the user shares a URL or asks about web content.",
  inputSchema: {
    type: "object",
    properties: {
      urls: {
        type: "array",
        items: { type: "string" },
        description: "One or more URLs to fetch (max 5). Only HTTP and HTTPS are supported.",
      },
    },
    required: ["urls"],
  },
};

interface FetchResult {
  url: string;
  title: string;
  content: string;
  contentType: string;
  savedPath: string;
  error: string;
}

export async function executeWebFetch(
  workspace: string,
  args: Record<string, unknown>,
): Promise<string> {
  let urls: string[];
  try {
    urls = parseUrls(args);
  } catch (error) {
    return errorMessage(error);
  }
  if (urls.length > WEB_FETCH_MAX_URLS) {
    return `Error: too many URLs (${urls.length}). Maximum is ${WEB_FETCH_MAX_URLS}.`;
  }

  const results: FetchResult[] = [];
  for (const url of urls) {
    results.push(await fetchAndExtractUrl(workspace, url));
  }

  let totalSize = 0;
  let output = "";
  results.forEach((result, index) => {
    if (index > 0) output += "\n---\n\n";
    let content = formatFetchResult(result);
    if (content.length > WEB_FETCH_MAX_RESULT_SIZE) {
      content = `${content.slice(0, WEB_FETCH_MAX_RESULT_SIZE)}\n\n[...content truncated at 50KB]`;
    }
    if (totalSize + content.length > WEB_FETCH_MAX_TOTAL_SIZE) {
      const remaining = WEB_FETCH_MAX_TOTAL_SIZE - totalSize;
      if (remaining > 0) {
        output += content.slice(0, remaining);
        output += "\n\n[...total output truncated at 200KB]";
      }
      return;
    }
    output += content;
    totalSize += content.length;
  });
  return output;
}

export function parseUrls(args: Record<string, unknown>): string[] {
  const raw = args["urls"];
  if (raw === undefined) throw new Error("Error: 'urls' parameter is required");
  if (typeof raw === "string") {
    if (!raw.trim()) throw new Error("Error: 'urls' parameter cannot be empty");
    return [raw];
  }
  if (Array.isArray(raw)) {
    if (raw.length === 0) throw new Error("Error: 'urls' parameter cannot be empty");
    return raw.map((item) => {
      if (typeof item !== "string") throw new Error("Error: each URL must be a string");
      return item;
    });
  }
  throw new Error("Error: 'urls' must be a string or array of strings");
}

async function fetchAndExtractUrl(workspace: string, rawUrl: string): Promise<FetchResult> {
  const result: FetchResult = {
    url: rawUrl,
    title: "",
    content: "",
    contentType: "",
    savedPath: "",
    error: "",
  };

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch (error) {
    result.error = `invalid URL: ${errorMessage(error)}`;
    return result;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    result.error = `unsupported scheme ${JSON.stringify(parsed.protocol.replace(":", ""))}: only http and https are allowed`;
    return result;
  }

  let response: Response;
  try {
    response = await fetchWithRedirects(rawUrl);
  } catch (error) {
    const message = errorMessage(error);
    result.error = /timeout|abort/i.test(message) ? "fetch timeout after 15s" : `fetch error: ${message}`;
    return result;
  }
  if (!response.ok) {
    result.error = `HTTP ${response.status}: ${response.statusText}`;
    return result;
  }

  const body = new Uint8Array(await response.arrayBuffer());
  if (body.length > WEB_FETCH_MAX_BODY_SIZE) {
    result.error = `response body exceeds ${WEB_FETCH_MAX_BODY_SIZE} bytes limit`;
    return result;
  }

  const contentType = response.headers.get("content-type") ?? "";
  result.contentType = contentType;
  const lower = contentType.toLowerCase();
  if (lower.includes("text/html")) {
    const extracted = extractHtmlContent(rawUrl, body);
    result.content = extracted.markdown;
    result.title = extracted.title;
  } else if (lower.includes("text/plain")) {
    result.content = new TextDecoder().decode(body);
    result.title = extractTitleFromUrl(rawUrl);
  } else {
    result.error = `unsupported content type: ${contentType}`;
    return result;
  }

  if (workspace && result.content) {
    try {
      result.savedPath = await persistFetchResult(workspace, result);
    } catch {
      result.savedPath = "";
    }
  }
  return result;
}

async function fetchWithRedirects(rawUrl: string): Promise<Response> {
  let current = rawUrl;
  for (let redirects = 0; redirects <= WEB_FETCH_MAX_REDIRECTS; redirects += 1) {
    const response = await fetch(current, {
      redirect: "manual",
      signal: AbortSignal.timeout(WEB_FETCH_TIMEOUT_MS),
      headers: { "User-Agent": "llmwiki-web-fetch/0.1" },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return response;
      if (redirects === WEB_FETCH_MAX_REDIRECTS) {
        throw new Error(`too many redirects (>${WEB_FETCH_MAX_REDIRECTS})`);
      }
      current = new URL(location, current).toString();
      continue;
    }
    return response;
  }
  throw new Error(`too many redirects (>${WEB_FETCH_MAX_REDIRECTS})`);
}

function extractHtmlContent(pageUrl: string, body: Uint8Array): { markdown: string; title: string } {
  const html = new TextDecoder().decode(body);
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = titleMatch?.[1] ? decodeEntities(stripTags(titleMatch[1])).trim() : extractTitleFromUrl(pageUrl);
  const article =
    /<article[^>]*>([\s\S]*?)<\/article>/i.exec(html)?.[1] ??
    /<main[^>]*>([\s\S]*?)<\/main>/i.exec(html)?.[1] ??
    html;
  return { markdown: htmlToMarkdown(article), title };
}

export function htmlToMarkdown(input: string): string {
  let html = input
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
    .replace(/<svg[\s\S]*?<\/svg>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");

  html = html.replace(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, (_m, code: string) => {
    return `\n\n\`\`\`\n${decodeEntities(stripTags(code))}\n\`\`\`\n\n`;
  });
  html = html.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_m, code: string) => {
    return `\n\n\`\`\`\n${decodeEntities(stripTags(code))}\n\`\`\`\n\n`;
  });
  html = html.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, level: string, text: string) => {
    return `\n\n${"#".repeat(Number(level))} ${inline(text)}\n\n`;
  });
  html = html.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_m, text: string) => {
    return `\n\n${inline(text)
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n")}\n\n`;
  });
  html = html.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_m, text: string) => `\n- ${inline(text)}`);
  html = html.replace(/<br\s*\/?>/gi, "\n");
  html = html.replace(/<\/(p|div|section|article|main|ul|ol|table|tr)>/gi, "\n\n");
  html = html.replace(/<(p|div|section|article|main|ul|ol|table|tr)[^>]*>/gi, "\n");
  html = html.replace(/<a[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, text: string) => {
    const label = inline(text);
    return label ? `[${label}](${href})` : "";
  });
  html = html.replace(/<img[^>]*alt=["']([^"']*)["'][^>]*src=["']([^"']*)["'][^>]*>/gi, (_m, alt: string, src: string) => `![${alt}](${src})`);
  html = html.replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, (_m, _tag: string, text: string) => `**${inline(text)}**`);
  html = html.replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, (_m, _tag: string, text: string) => `*${inline(text)}*`);
  html = html.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_m, text: string) => `\`${decodeEntities(stripTags(text))}\``);
  html = stripTags(html);
  return decodeEntities(html)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function inline(html: string): string {
  return decodeEntities(stripTags(html)).replace(/\s+/g, " ").trim();
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, "");
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, code: string) => String.fromCodePoint(Number.parseInt(code, 16)));
}

export function extractTitleFromUrl(rawUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return rawUrl;
  }
  let base = decodeURIComponent(parsed.pathname.replace(/\/+$/, "").split("/").pop() ?? "");
  const dot = base.lastIndexOf(".");
  if (dot > 0) base = base.slice(0, dot);
  base = base.replace(/[-_]/g, " ");
  if (!base || base === "." || base === "/") return parsed.host;
  return base;
}

export function urlSlug(value: string): string {
  let slug = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (!slug) return "index";
  if (slug.length > 80) slug = slug.slice(0, 80);
  return slug;
}

function formatFetchResult(result: FetchResult): string {
  let output = `## ${result.url}\n`;
  if (result.title) output += `> Title: ${result.title}\n`;
  output += `> Fetched: ${new Date().toISOString()}\n`;
  if (result.savedPath) output += `> Saved: ${result.savedPath}\n`;
  output += "\n";
  output += result.error ? `⚠️ Error: ${result.error}\n` : result.content;
  return output;
}

async function persistFetchResult(workspace: string, result: FetchResult): Promise<string> {
  if (!result.content) throw new Error("no content to persist");
  const parsed = new URL(result.url);
  const domain = parsed.host || "unknown";
  const slug = urlSlug(parsed.pathname);
  const stamp = timestampSlug(new Date());
  const filename = `${slug}-${stamp}.md`;
  const relPath = `${WEB_FETCH_BASE_DIR}/${domain}/${filename}`;
  const fullPath = path.join(workspace, relPath);

  const content = [
    "---",
    `source_url: ${result.url}`,
    `title: ${JSON.stringify(result.title)}`,
    `fetched_at: ${new Date().toISOString()}`,
    `content_type: ${result.contentType}`,
    "---",
    "",
    result.content,
  ].join("\n");

  await mkdir(path.dirname(fullPath), { recursive: true });
  const tempPath = `${fullPath}.tmp-${process.pid}-${Date.now()}`;
  try {
    await writeFile(tempPath, content, "utf8");
    await rename(tempPath, fullPath);
  } catch (error) {
    await unlink(tempPath).catch(() => {});
    throw error;
  }
  return relPath;
}

function timestampSlug(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
