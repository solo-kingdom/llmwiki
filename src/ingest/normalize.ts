import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  INPUT_KIND_CONVERSATION,
  INPUT_KIND_SESSION_ARCHIVE,
  INPUT_KIND_TEXT,
  INPUT_KIND_UPLOAD,
  type InputKind,
  type NormalizedSource,
} from "./types.js";

export const WEB_INGEST_BASE_DIR = "raw/sources/web-ingest";

export function slug(value: string): string {
  const lowered = value.trim().toLowerCase();
  if (!lowered) return "";
  let out = "";
  let lastDash = false;
  for (const char of lowered) {
    if ((char >= "a" && char <= "z") || (char >= "0" && char <= "9")) {
      out += char;
      lastDash = false;
    } else if (char === "-" || char === "_" || char === " ") {
      if (!lastDash) {
        out += "-";
        lastDash = true;
      }
    }
  }
  return out.replace(/^-+|-+$/g, "");
}

function canonicalPath(name: string): string {
  let base = path.basename(name.trim());
  if (!base || base === "." || base === "/") base = `source-${randomUUID()}.txt`;
  return path.posix.join(WEB_INGEST_BASE_DIR, base);
}

function timestamp(now: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

export function normalizeConversation(
  title: string,
  content: string,
  sourceRef: string,
  now: Date,
): NormalizedSource {
  if (!content.trim()) throw new Error("content is required");
  const base = slug(title) || "conversation";
  const name = `${base}-${timestamp(now)}.md`;
  return {
    kind: INPUT_KIND_CONVERSATION,
    canonicalPath: canonicalPath(name),
    originalName: name,
    sourceRef: sourceRef.trim() || "conversation",
    content: Buffer.from(content, "utf8"),
  };
}

export function normalizeText(
  title: string,
  filename: string,
  content: string,
  sourceRef: string,
  now: Date,
): NormalizedSource {
  if (!content.trim()) throw new Error("content is required");
  let name = filename.trim();
  if (!name) {
    const base = slug(title) || "text";
    name = `${base}-${timestamp(now)}.md`;
  }
  return {
    kind: INPUT_KIND_TEXT,
    canonicalPath: canonicalPath(name),
    originalName: name,
    sourceRef: sourceRef.trim() || "text",
    content: Buffer.from(content, "utf8"),
  };
}

export function normalizeUpload(
  filename: string,
  content: Uint8Array,
  sourceRef: string,
): NormalizedSource {
  const name = filename.trim();
  if (!name) throw new Error("filename is required");
  if (content.length === 0) throw new Error("content is required");
  return {
    kind: INPUT_KIND_UPLOAD,
    canonicalPath: canonicalPath(name),
    originalName: name,
    sourceRef: sourceRef.trim() || "upload",
    content,
  };
}

export async function normalizeJobSource(
  workspace: string,
  inputType: string,
  sourcePath: string,
  sourceRef: string,
): Promise<NormalizedSource> {
  const full = path.join(workspace, sourcePath);
  let content: Uint8Array;
  try {
    content = await readFile(full);
  } catch (error) {
    throw new Error(`read source: ${errorMessage(error)}`);
  }
  const base = path.basename(sourcePath);
  const kind = inputType.trim() as InputKind;
  switch (kind) {
    case INPUT_KIND_CONVERSATION:
    case INPUT_KIND_TEXT:
    case INPUT_KIND_SESSION_ARCHIVE:
    case "review_plan":
    case "review_apply":
      return {
        kind: kind === "review_plan" || kind === "review_apply" ? INPUT_KIND_SESSION_ARCHIVE : kind,
        canonicalPath: sourcePath,
        originalName: base,
        sourceRef,
        content,
      };
    default:
      return normalizeUpload(base, content, sourceRef);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
