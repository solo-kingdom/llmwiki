export type TimeRangePreset = "all" | "today" | "7d" | "30d" | "90d" | "custom"

export interface ResolvedTimelineRange {
  from?: string
  to?: string
  invalid?: boolean
}

function localDayStart(year: number, monthIndex: number, day: number): Date {
  return new Date(year, monthIndex, day, 0, 0, 0, 0)
}

function localDayEnd(year: number, monthIndex: number, day: number): Date {
  return new Date(year, monthIndex, day, 23, 59, 59, 0)
}

function parseDateInput(raw: string): { year: number; monthIndex: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim())
  if (!match) return null
  return {
    year: Number(match[1]),
    monthIndex: Number(match[2]) - 1,
    day: Number(match[3]),
  }
}

/**
 * Converts a timeline preset or custom `YYYY-MM-DD` local-date bounds into ISO-8601 UTC
 * strings for `GET /api/v1/history`.
 */
export function resolveTimelineRange(
  preset: TimeRangePreset,
  customFrom: string,
  customTo: string,
  now = new Date(),
): ResolvedTimelineRange {
  if (preset === "all") return {}

  if (preset === "custom") {
    const trimmedFrom = customFrom.trim()
    const trimmedTo = customTo.trim()
    if (trimmedFrom !== "" && trimmedTo !== "" && trimmedFrom > trimmedTo) {
      return { invalid: true }
    }
    const parsedFrom = trimmedFrom ? parseDateInput(trimmedFrom) : null
    const parsedTo = trimmedTo ? parseDateInput(trimmedTo) : null
    const out: ResolvedTimelineRange = {}
    if (parsedFrom) out.from = localDayStart(parsedFrom.year, parsedFrom.monthIndex, parsedFrom.day).toISOString()
    if (parsedTo) out.to = localDayEnd(parsedTo.year, parsedTo.monthIndex, parsedTo.day).toISOString()
    return out
  }

  const daysBack = preset === "today" ? 0 : preset === "7d" ? 6 : preset === "30d" ? 29 : 89
  const end = localDayEnd(now.getFullYear(), now.getMonth(), now.getDate())
  const start = localDayStart(now.getFullYear(), now.getMonth(), now.getDate() - daysBack)
  return {
    from: start.toISOString(),
    to: end.toISOString(),
  }
}
