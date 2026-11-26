/**
 * Router adapter — the only file that knows the router. Default: react-router.
 * Using another router? Re-implement these exports here; nothing else changes.
 */
import * as React from "react"
import { Link, useLocation, useNavigate, useSearchParams } from "react-router"

export type AppLinkProps = Omit<React.ComponentProps<"a">, "href"> & { to: string }

/** Navigation is always an anchor: new tab, middle click and copy-link work. */
export const AppLink = React.forwardRef<HTMLAnchorElement, AppLinkProps>(function AppLink({ to, ...props }, ref) {
  return <Link ref={ref} to={to} {...props} />
})

export function useAppNavigate(): (to: string, options?: { replace?: boolean }) => void {
  const navigate = useNavigate()
  return React.useCallback((to, options) => { void navigate(to, options) }, [navigate])
}

// "Clear filters" sets six params in one handler. React Router applies every functional setSearchParams
// against the same location snapshot, so concurrent calls overwrite each other and only the last one lands.
// Updates accumulate here and flush once per microtask instead.
let pendingSearch: URLSearchParams | null = null
let flushScheduled = false

/** One URL search param as state (filters, sort, tab, cursor). Empty/default values are removed from the URL. */
export function useUrlState(key: string, fallback = ""): [string, (value: string) => void] {
  const [params, setParams] = useSearchParams()
  const value = params.get(key) ?? fallback
  const set = React.useCallback((next: string) => {
    const copy = new URLSearchParams(pendingSearch ?? window.location.search)
    if (next === "" || next === fallback) copy.delete(key)
    else copy.set(key, next)
    pendingSearch = copy
    if (flushScheduled) return
    flushScheduled = true
    queueMicrotask(() => {
      const search = pendingSearch
      pendingSearch = null
      flushScheduled = false
      if (search !== null) setParams(search, { replace: true })
    })
  }, [key, fallback, setParams])
  return [value, set]
}

/** Current pathname, for active-nav matching. */
export function useAppPathname(): string {
  return useLocation().pathname
}

/** Current query string, including the leading `?` when present. */
export function useAppSearch(): string {
  return useLocation().search
}

/** True when `pathname` is `to` itself or one of its descendants ("/" only matches itself). */
export function isActivePath(pathname: string, to: string): boolean {
  return to === "/" ? pathname === "/" : pathname === to || pathname.startsWith(to.endsWith("/") ? to : to + "/")
}

/** True when `to` is the current path or one of its ancestors ("/" only matches itself). */
export function useIsActive(to: string): boolean {
  return isActivePath(useAppPathname(), to)
}

/**
 * The most specific candidate matching `pathname`, for navs that contain both a parent and a child
 * ("/wiki" and "/wiki/graph"): prefix matching would light both, so only the longest match may be active.
 */
export function pickActive(pathname: string, candidates: readonly string[]): string | undefined {
  let best: string | undefined
  for (const to of candidates) {
    if (isActivePath(pathname, to) && (best === undefined || to.length > best.length)) best = to
  }
  return best
}
