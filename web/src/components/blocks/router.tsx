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

/** One URL search param as state (filters, sort, tab, cursor). Empty/default values are removed from the URL. */
export function useUrlState(key: string, fallback = ""): [string, (value: string) => void] {
  const [params, setParams] = useSearchParams()
  const value = params.get(key) ?? fallback
  const set = React.useCallback((next: string) => {
    setParams((current) => {
      const copy = new URLSearchParams(current)
      if (next === "" || next === fallback) copy.delete(key)
      else copy.set(key, next)
      return copy
    }, { replace: true })
  }, [key, fallback, setParams])
  return [value, set]
}

/** Current pathname, for active-nav matching. */
export function useAppPathname(): string {
  return useLocation().pathname
}

/** True when `to` is the current path or one of its ancestors ("/" only matches itself). */
export function useIsActive(to: string): boolean {
  const pathname = useAppPathname()
  return to === "/" ? pathname === "/" : pathname === to || pathname.startsWith(to.endsWith("/") ? to : to + "/")
}
