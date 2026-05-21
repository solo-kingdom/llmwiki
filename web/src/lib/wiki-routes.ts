import { useSyncExternalStore } from "react"

export const PATH_CHANGE_EVENT = "llmwiki:pathchange"

export type WorkbenchView =
  | "chat"
  | "ingest"
  | "review"
  | "jobs"
  | "timeline"
  | "logs"
  | "settings"

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

export function getWorkbenchViewFromPath(pathname: string): WorkbenchView {
  switch (pathname) {
    case "/ingest":
      return "ingest"
    case "/review":
      return "review"
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
    case "ingest":
      return "/ingest"
    case "review":
      return "/review"
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
