export function isWikiReaderPath(pathname: string): boolean {
  return pathname === "/wiki" || pathname.startsWith("/wiki/")
}

export function wikiReaderHref(docId?: string | null): string {
  if (!docId) return "/wiki"
  return `/wiki?doc=${encodeURIComponent(docId)}`
}

export function workbenchHref(): string {
  return "/"
}

export function getDocIdFromLocation(
  search: string,
  pathname: string,
): string | null {
  const params = new URLSearchParams(search)
  const fromQuery = params.get("doc")
  if (fromQuery) return fromQuery

  const match = pathname.match(/^\/wiki\/d\/([^/]+)$/)
  return match ? decodeURIComponent(match[1]) : null
}
