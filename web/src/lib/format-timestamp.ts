/** Parse git log `%ci` timestamp (e.g. "2026-05-20 18:53:10 +0800"). */
export function parseGitCommitTimestamp(ts: string): Date | null {
  const trimmed = ts.trim()
  if (!trimmed) return null

  const m = trimmed.match(
    /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ([+-])(\d{2})(\d{2})$/,
  )
  if (m) {
    const iso = `${m[1]}T${m[2]}${m[3]}${m[4]}:${m[5]}`
    const date = new Date(iso)
    return Number.isNaN(date.getTime()) ? null : date
  }

  let candidate = trimmed.includes(" ") ? trimmed.replace(" ", "T") : trimmed
  // PostgreSQL stores UTC without an offset; treat bare timestamps as UTC.
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(candidate)) {
    candidate += "Z"
  }
  const fallback = new Date(candidate)
  return Number.isNaN(fallback.getTime()) ? null : fallback
}

/** Relative or short date label for a git commit timestamp. */
export function formatGitCommitTimestamp(ts: string): string {
  const date = parseGitCommitTimestamp(ts)
  if (!date) return ts.trim() || ""

  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  const diffHr = Math.floor(diffMin / 60)
  const diffDay = Math.floor(diffHr / 24)

  if (diffMin < 1) return "just now"
  if (diffMin < 60) return `${diffMin}m ago`
  if (diffHr < 24) return `${diffHr}h ago`
  if (diffDay < 7) return `${diffDay}d ago`
  return date.toLocaleDateString()
}
