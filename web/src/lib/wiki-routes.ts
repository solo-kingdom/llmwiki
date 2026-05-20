export const PATH_CHANGE_EVENT = "llmwiki:pathchange"

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

/** Notify AppRouter and other listeners that pathname changed without popstate. */
export function notifyPathChange() {
  window.dispatchEvent(new Event(PATH_CHANGE_EVENT))
}

/** Client-side navigation for SPA shells (wiki ↔ workbench). */
export function navigateTo(path: string) {
  const target = path.startsWith("/") ? path : `/${path}`
  const current = window.location.pathname + window.location.search
  if (current === target) return
  window.history.pushState(null, "", target)
  notifyPathChange()
}
