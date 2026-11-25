export interface Reference {
  targetPath: string;
  refType: "cites" | "links_to";
  page: number | null;
}

export interface DocIndexEntry {
  id: string;
  filename: string;
  title: string;
  path: string;
  aliases?: string[];
}

export interface LinkResolution {
  targetId: string;
  ambiguous: boolean;
  candidates: string[];
}

export const WIKI_DOUBLE_BRACKET_RE = /\[\[([^\]|#]+?)\\?(?:\|[^\]]*)?\]\]/g;
export const WIKI_LINK_RE = /(!?)\[([^\]]*)\]\(([^)]+)\)/g;

export class ReferenceParser {
  private docsByFilename = new Map<string, string>();
  private docsByBase = new Map<string, string>();
  private docsByWikiPath = new Map<string, string>();
  private docsBySlug = new Map<string, string>();
  private docsByAlias = new Map<string, string>();
  private ownersByKey = new Map<string, Set<string>>();

  constructor(docs: DocIndexEntry[]) {
    const recordOwner = (key: string, docId: string) => {
      const clean = key.trim().toLowerCase();
      if (!clean) return;
      let set = this.ownersByKey.get(clean);
      if (!set) {
        set = new Set();
        this.ownersByKey.set(clean, set);
      }
      set.add(docId);
    };

    for (const doc of docs) {
      const filenameLower = doc.filename.toLowerCase();
      this.docsByFilename.set(filenameLower, doc.id);
      recordOwner(filenameLower, doc.id);
      recordOwner(stripExtension(filenameLower), doc.id);

      if (doc.title) {
        const titleLower = doc.title.toLowerCase();
        if (!this.docsByFilename.has(titleLower)) {
          this.docsByFilename.set(titleLower, doc.id);
        }
        recordOwner(titleLower, doc.id);
      }
      this.docsByBase.set(stripExtension(filenameLower), doc.id);

      for (const alias of doc.aliases ?? []) {
        const aliasLower = alias.trim().toLowerCase();
        if (!aliasLower) continue;
        if (!this.docsByAlias.has(aliasLower)) {
          this.docsByAlias.set(aliasLower, doc.id);
        }
        recordOwner(aliasLower, doc.id);
        const aliasSlug = slugify(aliasLower);
        if (aliasSlug) {
          if (!this.docsByAlias.has(aliasSlug)) this.docsByAlias.set(aliasSlug, doc.id);
          recordOwner(aliasSlug, doc.id);
        }
      }

      if (doc.path.startsWith("/wiki")) {
        let relative = doc.path.slice("/wiki".length).replace(/^\/+/, "");
        if (relative && !relative.endsWith("/")) relative += "/";
        relative += doc.filename;
        const key = relative.toLowerCase();
        this.docsByWikiPath.set(key, doc.id);
        recordOwner(key, doc.id);
        recordOwner(stripExtension(key), doc.id);

        const slug = slugify(key);
        if (slug && !this.docsBySlug.has(slug)) {
          this.docsBySlug.set(slug, doc.id);
        }
        const lastSlash = key.lastIndexOf("/");
        const basePart = lastSlash >= 0 ? key.slice(lastSlash + 1) : key;
        const baseSlug = slugify(basePart);
        if (baseSlug && !this.docsBySlug.has(baseSlug)) {
          this.docsBySlug.set(baseSlug, doc.id);
        }
        const dotIndex = baseSlug.lastIndexOf(".");
        const baseNoExt = dotIndex > 0 ? baseSlug.slice(0, dotIndex) : baseSlug;
        if (baseNoExt && baseNoExt !== baseSlug && !this.docsBySlug.has(baseNoExt)) {
          this.docsBySlug.set(baseNoExt, doc.id);
        }
      }
    }
  }

  parseReferences(content: string, docPath: string): Reference[] {
    return [...this.parseCitations(content), ...this.parseWikiLinks(content, docPath)];
  }

  /** Resolve a single [[..]] target against the doc index; "" when unmatched. */
  resolveLink(target: string, docPath: string): string {
    let wikiRel = "";
    if (docPath.startsWith("/wiki/")) {
      wikiRel = docPath.slice("/wiki/".length);
      const index = wikiRel.lastIndexOf("/");
      wikiRel = index >= 0 ? wikiRel.slice(0, index + 1) : "";
    }
    return this.resolveWikiPath(target.trim(), wikiRel);
  }

  /** Resolve target with ambiguity details for lint diagnostics. */
  resolveLinkDetailed(target: string, docPath: string): LinkResolution {
    const clean = target.trim();
    const targetId = this.resolveLink(clean, docPath);
    // Path-qualified targets (containing "/") are explicit unless multiple exact paths collide.
    const lower = clean.toLowerCase().replace(/^\/?wiki\//, "");
    const candidates = new Set<string>();
    for (const key of [lower, stripExtension(lower), slugify(lower)]) {
      const owners = this.ownersByKey.get(key);
      if (owners) {
        for (const id of owners) candidates.add(id);
      }
    }
    // If target contains "/", check exact path owners first so path-qualified links resolve ambiguity.
    if (clean.includes("/")) {
      const pathOwners =
        this.ownersByKey.get(lower) ?? this.ownersByKey.get(`${lower}.md`);
      if (pathOwners && pathOwners.size === 1) {
        return { targetId, ambiguous: false, candidates: [...pathOwners] };
      }
    }
    return {
      targetId,
      ambiguous: candidates.size > 1,
      candidates: [...candidates],
    };
  }

  private parseCitations(content: string): Reference[] {
    const references: Reference[] = [];
    const citationRe = /^\[\^\d+\]:\s*(.+)$/gm;
    for (const match of content.matchAll(citationRe)) {
      let raw = (match[1] ?? "").trim().replace(/^\*+|\*+$/g, "");
      const [filename, page] = parseCitationFile(raw);
      if (!filename) continue;
      const targetId = this.resolveFilename(filename);
      if (!targetId) continue;
      references.push({ targetPath: targetId, refType: "cites", page });
    }
    return references;
  }

  private parseWikiLinks(content: string, docPath: string): Reference[] {
    let wikiRel = "";
    if (docPath.startsWith("/wiki/")) {
      wikiRel = docPath.slice("/wiki/".length);
      const index = wikiRel.lastIndexOf("/");
      wikiRel = index >= 0 ? wikiRel.slice(0, index + 1) : "";
    }

    const references: Reference[] = [];
    for (const match of content.matchAll(WIKI_LINK_RE)) {
      const prefix = match[1] ?? "";
      const href = match[3] ?? "";
      if (prefix === "!") continue;
      if (
        href.startsWith("http://") ||
        href.startsWith("https://") ||
        href.startsWith("#") ||
        href.startsWith("mailto:")
      ) {
        continue;
      }
      const lower = href.toLowerCase();
      if ([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"].some((ext) => lower.endsWith(ext))) {
        continue;
      }
      const resolved = this.resolveWikiPath(href, wikiRel);
      if (!resolved) continue;
      references.push({ targetPath: resolved, refType: "links_to", page: null });
    }

    for (const match of content.matchAll(WIKI_DOUBLE_BRACKET_RE)) {
      const target = (match[1] ?? "").trim();
      const resolved = this.resolveWikiPath(target, wikiRel);
      if (!resolved) continue;
      references.push({ targetPath: resolved, refType: "links_to", page: null });
    }
    return references;
  }

  private resolveWikiPath(href: string, wikiRel: string): string {
    let resolved = href;
    if (href.startsWith("/wiki/")) {
      resolved = href.slice("/wiki/".length);
    } else if (href.startsWith("./")) {
      resolved = wikiRel + href.slice(2);
    } else if (href.startsWith("../")) {
      const parts = (wikiRel + href).split("/");
      const clean: string[] = [];
      for (const part of parts) {
        if (part === "..") {
          if (clean.length > 0) clean.pop();
        } else if (part !== "." && part !== "") {
          clean.push(part);
        }
      }
      resolved = clean.join("/");
    } else if (!href.includes("/")) {
      resolved = wikiRel + href;
    }

    const resolvedLower = resolved.toLowerCase();
    // Links often write spaces where filenames/titles use underscores
    // ([[Adam Foroughi]] vs Adam_Foroughi.md); try both variants.
    const variants = new Set([resolvedLower, resolvedLower.replace(/ /g, "_")]);

    for (const variant of variants) {
      const exact = this.docsByWikiPath.get(variant);
      if (exact) return exact;
      const withMd = this.docsByWikiPath.get(`${variant}.md`);
      if (withMd) return withMd;
    }

    let basename = resolvedLower;
    const lastSlash = basename.lastIndexOf("/");
    if (lastSlash >= 0) basename = basename.slice(lastSlash + 1);
    for (const [pathKey, id] of this.docsByWikiPath) {
      const pathBase = lastSlash >= 0 ? pathKey.slice(pathKey.lastIndexOf("/") + 1) : pathKey;
      if (pathBase === basename || pathBase === `${basename}.md`) return id;
      // filename side may hold the underscores the link wrote as spaces
      const pathBaseSpaced = pathBase.replace(/_/g, " ");
      if (pathBaseSpaced !== pathBase && (pathBaseSpaced === basename || pathBaseSpaced === `${basename}.md`)) {
        return id;
      }
    }

    for (const variant of variants) {
      const slugified = slugify(variant);
      if (!slugified) continue;
      const slugMatch = this.docsBySlug.get(slugified);
      if (slugMatch) return slugMatch;
      const slugMd = this.docsBySlug.get(`${slugified}.md`);
      if (slugMd) return slugMd;
      const slugIndex = slugified.lastIndexOf("/");
      const slugBase = slugIndex >= 0 ? slugified.slice(slugIndex + 1) : slugified;
      if (slugBase !== slugified) {
        const baseMatch = this.docsBySlug.get(slugBase);
        if (baseMatch) return baseMatch;
        const baseMd = this.docsBySlug.get(`${slugBase}.md`);
        if (baseMd) return baseMd;
      }
    }

    for (const variant of variants) {
      const byFilename = this.docsByFilename.get(variant);
      if (byFilename) return byFilename;
      const byBase = this.docsByBase.get(stripExtension(variant));
      if (byBase) return byBase;
      const byAlias = this.docsByAlias.get(variant) ?? this.docsByAlias.get(slugify(variant));
      if (byAlias) return byAlias;
    }

    const rawLower = href.trim().toLowerCase();
    const rawAlias = this.docsByAlias.get(rawLower) ?? this.docsByAlias.get(slugify(rawLower));
    if (rawAlias) return rawAlias;

    return "";
  }

  private resolveFilename(filename: string): string {
    const lower = filename.toLowerCase();
    const byFilename = this.docsByFilename.get(lower);
    if (byFilename) return byFilename;
    return this.docsByBase.get(stripExtension(lower)) ?? "";
  }
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/ /g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function stripExtension(name: string): string {
  for (const ext of [
    ".pdf",
    ".docx",
    ".doc",
    ".pptx",
    ".ppt",
    ".xlsx",
    ".xls",
    ".csv",
    ".html",
    ".htm",
    ".md",
    ".txt",
  ]) {
    if (name.endsWith(ext)) return name.slice(0, -ext.length);
  }
  const index = name.lastIndexOf(".");
  return index > 0 ? name.slice(0, index) : name;
}

function parseCitationFile(raw: string): [string, number | null] {
  const linkMatch = /\[([^\]]+)\]\([^)]*\)/.exec(raw);
  if (linkMatch) raw = linkMatch[1] ?? raw;

  const pageRe = /^(.+?)(?:,\s*p\.?\s*(\d+))?(?:\s*[-–—].*)?$/;
  const parts = pageRe.exec(raw);
  if (!parts) return [raw, null];
  const filename = (parts[1] ?? "").trim();
  const page = parts[2] ? Number.parseInt(parts[2], 10) : null;
  return [filename, Number.isFinite(page) ? page : null];
}
