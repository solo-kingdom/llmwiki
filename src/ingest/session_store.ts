import path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { slugWithFallback } from "./normalize.js";
import {
  INPUT_KIND_SESSION_ARCHIVE,
  type NormalizedSource,
  type SessionArchiveMessage,
  type SessionArchiveReference,
} from "./types.js";

export const SESSION_BASE_DIR = "raw/sources/web-ingest/sessions";
const ARCHIVE_FRONTMATTER_RE = /^---\n([\s\S]*?)\n---/;

export function defaultIngestSessionTitle(no: number, now: Date): string {
  return `#${no} ${formatDate(now)}`;
}

export function sessionDir(sessionId: string): string {
  return path.posix.join(SESSION_BASE_DIR, sessionId);
}

export function sessionAttachmentsDir(sessionId: string): string {
  return path.posix.join(sessionDir(sessionId), "attachments");
}

export function buildSessionArchiveMarkdown(
  sessionId: string,
  title: string,
  mode: string,
  messages: SessionArchiveMessage[],
  refs: SessionArchiveReference[],
  archivedAt: Date,
): string {
  const lines: string[] = ["---", `session_id: ${sessionId}`];
  if (title.trim()) lines.push(`title: ${title}`);
  lines.push(`archived_at: ${archivedAt.toISOString()}`, "source: web-ingest-session");
  if (mode && mode !== "ingest") lines.push(`session_mode: ${mode}`);
  if (refs.length > 0) {
    const yaml = stringifyYaml({ referenced_wiki_pages: refs }).trim();
    if (yaml) lines.push(yaml);
  }
  lines.push("---", "", "# Ingest Session Archive", "");

  if (refs.length > 0) {
    lines.push("## Referenced Wiki Pages", "");
    for (const ref of refs) {
      lines.push(`- [[${ref.path}]] — ${ref.title || ref.path} (${ref.source})`);
    }
    lines.push("");
  }

  for (const message of messages) {
    let role = message.role;
    if (role === "user") role = "User";
    else if (role === "assistant") role = "Assistant";
    if (message.messageType === "attachment_summary") role = "Attachment";
    lines.push(`## ${role}`, "", message.content, "");
    if (message.attachmentPath) lines.push(`_attachment: \`${message.attachmentPath}\`_`, "");
  }
  return `${lines.join("\n")}\n`;
}

export function parseReferencedWikiPagesFromArchive(content: string): SessionArchiveReference[] {
  const match = ARCHIVE_FRONTMATTER_RE.exec(content);
  if (!match) return [];
  try {
    const parsed = parseYaml(match[1] ?? "") as {
      referenced_wiki_pages?: SessionArchiveReference[];
    } | null;
    return parsed?.referenced_wiki_pages ?? [];
  } catch {
    return [];
  }
}

export function parseSessionModeFromArchive(content: string): string {
  const match = ARCHIVE_FRONTMATTER_RE.exec(content);
  if (!match) return "";
  try {
    const parsed = parseYaml(match[1] ?? "") as { session_mode?: string } | null;
    return parsed?.session_mode ?? "";
  } catch {
    return "";
  }
}

export function formatReferencedPagesForAnalysis(
  docLang: string,
  refs: SessionArchiveReference[],
): string {
  if (refs.length === 0) return "";
  const header =
    docLang === "en"
      ? "Existing wiki pages referenced during the session (prefer update/merge over create when planning):\n"
      : "会话中引用的已有 wiki 页面（规划时优先 update/merge，而非盲目 create）：\n";
  return header + refs.map((ref) => `- ${ref.path} — ${ref.title || ref.path} [${ref.source}]\n`).join("");
}

export function formatReferencedPagesForAnalysisWithMode(
  docLang: string,
  refs: SessionArchiveReference[],
  mode: string,
): string {
  if (refs.length === 0) return "";
  let header: string;
  if (mode === "organize") {
    header =
      docLang === "en"
        ? "Wiki pages that may need reorganization (focus on update/move/merge):\n"
        : "可能需要重组的 wiki 页面（侧重 update/move/merge）：\n";
  } else if (mode === "qa") {
    header =
      docLang === "en"
        ? "Wiki pages discussed during Q&A (update with new insights if needed):\n"
        : "问答中讨论的 wiki 页面（如有新见解可更新）：\n";
  } else {
    header =
      docLang === "en"
        ? "Existing wiki pages referenced during the session (prefer update/merge over create when planning):\n"
        : "会话中引用的已有 wiki 页面（规划时优先 update/merge，而非盲目 create）：\n";
  }
  return header + refs.map((ref) => `- ${ref.path} — ${ref.title || ref.path} [${ref.source}]\n`).join("");
}

export function normalizeSessionArchive(
  sessionId: string,
  title: string,
  content: string,
  sourceRef: string,
  now: Date,
): NormalizedSource {
  if (!content.trim()) throw new Error("content is required");
  const name = `${slugWithFallback(title, "session", now)}.md`;
  const relPath = path.posix.join(sessionDir(sessionId), name);
  return {
    kind: INPUT_KIND_SESSION_ARCHIVE,
    canonicalPath: relPath,
    originalName: name,
    sourceRef: sourceRef.trim() || `session_archive:${sessionId}`,
    ...(title.trim() ? { title: title.trim() } : {}),
    content: Buffer.from(content, "utf8"),
  };
}

function formatDate(now: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function timestamp(now: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}
