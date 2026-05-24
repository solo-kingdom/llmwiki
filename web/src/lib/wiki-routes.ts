import { useSyncExternalStore } from "react"

export const PATH_CHANGE_EVENT = "llmwiki:pathchange"

export type WorkbenchView =
  | "chat"
  | "jobs"
  | "timeline"
  | "logs"
  | "settings"

export const ADD_CONTEXT_QUERY = "addContext"
/** @deprecated Use ADD_CONTEXT_QUERY; kept for deep-link compatibility */
export const DIRECT_INGEST_QUERY = "directIngest"

export function addContextHref(): string {
  return `/?${ADD_CONTEXT_QUERY}=1`
}

/** @deprecated Use addContextHref */
export function directIngestHref(): string {
  return addContextHref()
}

export function isAddContextRequested(search: string): boolean {
  const params = new URLSearchParams(search)
  return (
    params.get(ADD_CONTEXT_QUERY) === "1" ||
    params.get(DIRECT_INGEST_QUERY) === "1"
  )
}

/** @deprecated Use isAddContextRequested */
export function isDirectIngestRequested(search: string): boolean {
  return isAddContextRequested(search)
}

export function clearAddContextQuery(search: string): string {
  const params = new URLSearchParams(search)
  params.delete(ADD_CONTEXT_QUERY)
  params.delete(DIRECT_INGEST_QUERY)
  const next = params.toString()
  return next ? `/?${next}` : "/"
}

/** @deprecated Use clearAddContextQuery */
export function clearDirectIngestQuery(search: string): string {
  return clearAddContextQuery(search)
}

export function isWikiReaderPath(pathname: string): boolean {
  return pathname === "/wiki" || pathname.startsWith("/wiki/")
}

export function isWikiGraphPath(pathname: string): boolean {
  return pathname === "/wiki/graph"
}

export function wikiGraphHref(): string {
  return "/wiki/graph"
}

export function wikiReaderHref(docId?: string | null): string {
  if (!docId) return "/wiki"
  return `/wiki?doc=${encodeURIComponent(docId)}`
}

export function workbenchHref(): string {
  return "/"
}

export function getWorkbenchViewFromPath(pathname: string): WorkbenchView {
  switch (pathname) {
    case "/ingest":
      return "chat"
    case "/jobs":
      return "jobs"
    case "/settings":
      return "settings"
    case "/timeline":
      return "timeline"
    case "/logs":
      return "logs"
    default:
      return "chat"
  }
}

export function workbenchViewHref(view: WorkbenchView): string {
  switch (view) {
    case "jobs":
      return "/jobs"
    case "settings":
      return "/settings"
    case "timeline":
      return "/timeline"
    case "logs":
      return "/logs"
    default:
      return "/"
  }
}

export function timelineCommitHref(sha: string): string {
  return `/timeline?commit=${encodeURIComponent(sha)}`
}

function subscribePath(cb: () => void) {
  const onChange = () => cb()
  window.addEventListener("popstate", onChange)
  window.addEventListener(PATH_CHANGE_EVENT, onChange)

  const origPush = history.pushState.bind(history)
  const origReplace = history.replaceState.bind(history)
  history.pushState = (...args: Parameters<typeof history.pushState>) => {
    origPush(...args)
    onChange()
  }
  history.replaceState = (...args: Parameters<typeof history.replaceState>) => {
    origReplace(...args)
    onChange()
  }

  return () => {
    window.removeEventListener("popstate", onChange)
    window.removeEventListener(PATH_CHANGE_EVENT, onChange)
    history.pushState = origPush
    history.replaceState = origReplace
  }
}

function getPathname() {
  return window.location.pathname
}

export function usePathname() {
  return useSyncExternalStore(subscribePath, getPathname, getPathname)
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
