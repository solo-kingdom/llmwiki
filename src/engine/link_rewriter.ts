import path from "node:path";

export interface PathRewrite {
  oldRelPath: string;
  newRelPath: string;
}

function stripWikiPrefix(relPath: string): string {
  return relPath.replace(/^\/+/, "").replace(/^wiki\//, "");
}

function stripMdExt(value: string): string {
  return value.toLowerCase().endsWith(".md") ? value.slice(0, -3) : value;
}

function normalizePosix(value: string): string {
  return path.posix.normalize(value.replace(/\\/g, "/")).replace(/^\.\//, "");
}

/**
 * Rewrite explicit path-qualified wikilinks (`[[folder/Page]]`, `[[wiki/folder/Page]]`)
 * and markdown links (`[label](folder/Page.md)`, `[label](/wiki/folder/Page.md)`, `../...`)
 * in a document body, leaving fenced code blocks and short `[[Page]]` links untouched.
 */
export function rewriteWikiPathLinks(
  content: string,
  rewrites: PathRewrite[],
  sourceRelPath = "",
): { content: string; changed: boolean } {
  if (!content || rewrites.length === 0) return { content, changed: false };

  // Build lookup from explicit old path forms -> new path forms
  const wikiTargetMap = new Map<string, PathRewrite>();
  for (const rw of rewrites) {
    const oldSub = stripWikiPrefix(rw.oldRelPath);
    const oldNoExt = stripMdExt(oldSub);
    wikiTargetMap.set(oldSub.toLowerCase(), rw);
    wikiTargetMap.set(oldNoExt.toLowerCase(), rw);
    wikiTargetMap.set(`wiki/${oldSub}`.toLowerCase(), rw);
    wikiTargetMap.set(`wiki/${oldNoExt}`.toLowerCase(), rw);
  }

  const sourceWikiDir = (() => {
    const sub = stripWikiPrefix(sourceRelPath);
    const dir = path.posix.dirname(sub);
    return dir === "." ? "" : `${dir}/`;
  })();

  let fence = "";
  let changed = false;
  const lines = content.split("\n");
  const outLines = lines.map((line) => {
    const fenceMatch = /^\s*(```+|~~~+)/.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1]?.[0] ?? "`";
      if (fence === "") fence = marker;
      else if (fence === marker) fence = "";
      return line;
    }
    if (fence !== "") return line;

    let nextLine = line.replace(
      /\[\[([^\]|#]+)((?:#[^\]|]*)?)((?:\|[^\]]*)?)\]\]/g,
      (full, rawTarget: string, anchor: string, label: string) => {
        const trimmed = rawTarget.trim();
        if (!trimmed.includes("/")) return full;
        const hadLeadingSlash = trimmed.startsWith("/");
        const key = trimmed.replace(/^\/+/, "").toLowerCase();
        const rw = wikiTargetMap.get(key) ?? wikiTargetMap.get(key.replace(/ /g, "_"));
        if (!rw) return full;

        const newSub = stripWikiPrefix(rw.newRelPath);
        const hadWikiPrefix = key.startsWith("wiki/");
        const hadMdExt = key.endsWith(".md");
        let replacement = hadWikiPrefix ? `wiki/${newSub}` : newSub;
        if (!hadMdExt) replacement = stripMdExt(replacement);
        if (hadLeadingSlash) replacement = `/${replacement}`;
        changed = true;
        return `[[${replacement}${anchor}${label}]]`;
      },
    );

    nextLine = nextLine.replace(
      /(!?)\[([^\]]*)\]\(([^)]+)\)/g,
      (full, prefix: string, label: string, rawHref: string) => {
        if (prefix === "!") return full;
        const href = rawHref.trim();
        if (
          !href ||
          href.startsWith("http://") ||
          href.startsWith("https://") ||
          href.startsWith("#") ||
          href.startsWith("mailto:")
        ) {
          return full;
        }
        const [hrefPath = "", hash = ""] = href.split(/(?=#)/);
        if (!hrefPath.includes("/")) return full;

        let resolvedKey = "";
        if (hrefPath.startsWith("/wiki/")) {
          resolvedKey = normalizePosix(hrefPath.slice("/wiki/".length));
        } else if (hrefPath.startsWith("wiki/")) {
          resolvedKey = normalizePosix(hrefPath.slice("wiki/".length));
        } else if (hrefPath.startsWith("./") || hrefPath.startsWith("../")) {
          resolvedKey = normalizePosix(sourceWikiDir + hrefPath);
        } else {
          resolvedKey = normalizePosix(hrefPath);
        }

        const rw =
          wikiTargetMap.get(resolvedKey.toLowerCase()) ??
          wikiTargetMap.get(resolvedKey.replace(/ /g, "_").toLowerCase());
        if (!rw) return full;

        const newSub = stripWikiPrefix(rw.newRelPath);
        const hadMdExt = hrefPath.toLowerCase().endsWith(".md");
        let nextHref: string;
        if (hrefPath.startsWith("/wiki/")) {
          nextHref = `/wiki/${hadMdExt ? newSub : stripMdExt(newSub)}`;
        } else if (hrefPath.startsWith("wiki/")) {
          nextHref = `wiki/${hadMdExt ? newSub : stripMdExt(newSub)}`;
        } else {
          nextHref = `/wiki/${hadMdExt ? newSub : stripMdExt(newSub)}`;
        }
        changed = true;
        return `[${label}](${nextHref}${hash})`;
      },
    );

    return nextLine;
  });

  return { content: outLines.join("\n"), changed };
}
