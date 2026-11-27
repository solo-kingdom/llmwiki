import { WIKI_DOUBLE_BRACKET_RE } from "./references.js";

// WIKI_DOUBLE_BRACKET_RE is /g-flagged; matchAll clones it, so shared use is safe.

/** Trailing reference sections are stripped from stored wiki content and carried
 * in document_reference_entries instead. The LLM still generates them per
 * templates; extraction happens once at every write path (ingest apply, manual
 * API writes, migration) so stored content never embeds them. */

export type ReferenceEntryKind = "related" | "source";

export interface ExtractedReferenceEntry {
  kind: ReferenceEntryKind;
  /** [[..]] inner target text; full line text for free-text bullets. */
  rawText: string;
  /** Leading/trailing prose around the wikilink, e.g. "— 其领导的公司". */
  annotation: string;
  position: number;
}

export interface ExtractResult {
  content: string;
  entries: ExtractedReferenceEntry[];
  /** Section headings that looked like reference sections but were kept in
   * place (non-bullet content); surfaced by migration --dry-run. */
  skippedHeadings: string[];
}

const RELATED_SECTION_NAMES = new Set([
  "相关实体/概念",
  "相关实体",
  "相关概念",
  "相关页面",
  "related entities",
  "related concepts",
  "related",
]);

const SOURCE_SECTION_NAMES = new Set([
  "来源",
  "引用",
  "来源页面",
  "sources",
  "references",
]);

const HEADING_RE = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const BULLET_RE = /^\s*(?:[-*+]|\d+[.)])\s+(.+)$/;

interface Heading {
  line: number;
  level: number;
  text: string;
}

interface Section {
  kind: ReferenceEntryKind;
  heading: Heading;
  endLine: number; // exclusive
}

function normalizeHeadingName(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

function sectionKind(headingText: string): ReferenceEntryKind | null {
  const name = normalizeHeadingName(headingText);
  if (RELATED_SECTION_NAMES.has(name)) return "related";
  if (SOURCE_SECTION_NAMES.has(name)) return "source";
  return null;
}

function findHeadings(lines: string[]): Heading[] {
  const headings: Heading[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;
    const match = HEADING_RE.exec(line);
    if (match) headings.push({ line: i, level: match[1]?.length ?? 0, text: match[2] ?? "" });
  }
  return headings;
}

function findSections(headings: Heading[], lineCount: number): Section[] {
  const sections: Section[] = [];
  for (let h = 0; h < headings.length; h++) {
    const heading = headings[h];
    if (!heading) continue;
    const kind = sectionKind(heading.text);
    if (!kind) continue;
    let end = lineCount;
    for (let n = h + 1; n < headings.length; n++) {
      const next = headings[n];
      if (next && next.level <= heading.level) {
        end = next.line;
        break;
      }
    }
    sections.push({ kind, heading, endLine: end });
  }
  return sections;
}

/** Lines allowed after the trailing group at EOF: blank lines, blockquote
 * merge notes and HTML comments. Blockquote/comment lines are kept in content
 * when the sections are stripped; they never become entries. */
function isTailChrome(line: string): boolean {
  const trimmed = line.trim();
  return trimmed === "" || trimmed.startsWith(">") || trimmed.startsWith("<!--");
}

/** The trailing group is the maximal suffix of sections that all sit at the end
 * of the document and all match reference-section names. Sections appearing
 * mid-document (e.g. a lone 来源 before later prose sections) are never touched. */
function trailingGroup(sections: Section[], lines: string[]): Section[] {
  const group: Section[] = [];
  let expectedStart = -1;
  for (let i = sections.length - 1; i >= 0; i--) {
    const section = sections[i];
    if (!section) break;
    if (expectedStart >= 0 && section.endLine !== expectedStart) break;
    // Between group members only blank lines are allowed; past the last section
    // (to EOF) blockquote notes and comments are tolerated as tail chrome.
    const bridgeEnd = expectedStart >= 0 ? expectedStart : lines.length;
    const allowChrome = expectedStart < 0;
    let bridge = true;
    for (let l = section.endLine; l < bridgeEnd; l++) {
      const line = lines[l] ?? "";
      if (allowChrome ? !isTailChrome(line) : line.trim() !== "") {
        bridge = false;
        break;
      }
    }
    if (!bridge) break;
    group.push(section);
    expectedStart = section.heading.line;
  }
  return group.reverse();
}

function parseBullet(
  text: string,
  kind: ReferenceEntryKind,
  position: number,
): ExtractedReferenceEntry[] {
  const links = [...text.matchAll(WIKI_DOUBLE_BRACKET_RE)];
  if (links.length === 0) {
    const raw = text.trim();
    if (!raw) return [];
    return [{ kind, rawText: raw, annotation: "", position }];
  }
  let annotation = text.replace(WIKI_DOUBLE_BRACKET_RE, " ");
  annotation = annotation
    .replace(/\s+/g, " ")
    .replace(/^[\s\-—–:：,，.。]+/, "")
    .replace(/[\s\-—–:：,，.。]+$/, "")
    .trim();
  return links.map((link) => ({
    kind,
    rawText: (link[1] ?? "").trim(),
    annotation,
    position,
  }));
}

function sectionIsStrippable(lines: string[], section: Section): boolean {
  for (let i = section.heading.line + 1; i < section.endLine; i++) {
    const line = lines[i];
    if (line === undefined || line.trim() === "") continue;
    const trimmed = line.trimStart();
    if (trimmed.startsWith("<!--") || trimmed.startsWith(">")) continue;
    if (BULLET_RE.test(line)) continue;
    // Also strip compact lines containing only [[wikilink]] references.
    if (WIKI_DOUBLE_BRACKET_RE.test(trimmed)) {
      WIKI_DOUBLE_BRACKET_RE.lastIndex = 0;
      const stripped = trimmed.replace(WIKI_DOUBLE_BRACKET_RE, "").replace(/[\s\-—–:：,，.。;；]+/g, "");
      if (stripped.length <= 24) continue;
    }
    return false;
  }
  return true;
}

export function extractTrailingReferences(content: string): ExtractResult {
  const lines = content.split("\n");
  const sections = findSections(findHeadings(lines), lines.length);
  if (sections.length === 0) return { content, entries: [], skippedHeadings: [] };

  const group = trailingGroup(sections, lines);
  const stripped: Section[] = [];
  const skippedHeadings: string[] = [];
  for (let i = group.length - 1; i >= 0; i--) {
    const section = group[i];
    if (!section) break;
    if (!sectionIsStrippable(lines, section)) {
      skippedHeadings.push(section.heading.text);
      break; // keep this and every earlier section in place
    }
    stripped.unshift(section);
  }

  if (stripped.length === 0) return { content, entries: [], skippedHeadings };

  const entries: ExtractedReferenceEntry[] = [];
  let position = 0;
  for (const section of stripped) {
    for (let i = section.heading.line + 1; i < section.endLine; i++) {
      const line = lines[i];
      if (line === undefined) continue;
      const match = BULLET_RE.exec(line);
      if (!match) continue;
      entries.push(...parseBullet(match[1] ?? "", section.kind, position));
      position += 1;
    }
  }

  const first = stripped[0];
  const last = stripped[stripped.length - 1] ?? first;
  const kept = first ? lines.slice(0, first.heading.line) : lines.slice();
  // Tail chrome (blockquote merge notes, comments) inside or after the last
  // section stays in content — stripping removes the sections themselves only.
  if (last) {
    for (let l = last.heading.line + 1; l < lines.length; l++) {
      const line = lines[l] ?? "";
      const trimmed = line.trimStart();
      if (trimmed.startsWith(">") || trimmed.startsWith("<!--")) kept.push(line);
    }
  }
  while (kept.length > 0 && (kept[kept.length - 1] ?? "").trim() === "") kept.pop();
  const strippedContent = kept.join("\n");

  return { content: strippedContent, entries, skippedHeadings };
}

/** Convenience for write paths: strip a wiki markdown doc's trailing reference
 * sections. Non-wiki or non-markdown content passes through unchanged. */
export function normalizeWikiContent(
  content: string,
  sourceKind: string,
  fileType: string,
): ExtractResult {
  if (sourceKind !== "wiki" || fileType.toLowerCase() !== "md") {
    return { content, entries: [], skippedHeadings: [] };
  }
  return extractTrailingReferences(content);
}
