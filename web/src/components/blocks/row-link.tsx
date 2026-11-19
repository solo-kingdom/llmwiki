/**
 * RowLink — makes a whole row/card navigable with a real anchor stretched over it.
 * Parent must be `relative`; interactive children that should stay clickable get `relative z-10`.
 */
import { AppLink } from "@/components/blocks/router"

export function RowLink({ to, label }: { to: string; label: string }) {
  return (
    <AppLink to={to} aria-label={label}
      className="absolute inset-0 z-0 rounded-[inherit] focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none focus-visible:ring-inset" />
  )
}
