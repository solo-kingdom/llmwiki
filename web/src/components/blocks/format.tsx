/**
 * Formatting primitives. Pages never call toLocale*String / Intl directly — use these so time,
 * numbers, sizes and identifiers read the same everywhere (locale and zone come from vocab).
 */
import * as React from "react"
import { CheckIcon, CopyIcon } from "lucide-react"
import { cn } from "cn"
import { vocab } from "@/lib/vocab"

type DateInput = string | number | Date | null | undefined
const toDate = (value: DateInput): Date | null => {
  if (value === null || value === undefined || value === "") return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

export function formatDateTime(value: DateInput, options: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" }): string {
  const date = toDate(value)
  return date === null ? "—" : new Intl.DateTimeFormat(vocab.locale, { timeZone: vocab.timeZone, ...options }).format(date)
}

export function formatRelative(value: DateInput, now: number = Date.now()): string {
  const date = toDate(value)
  if (date === null) return "—"
  const seconds = Math.round((date.getTime() - now) / 1000)
  const abs = Math.abs(seconds)
  const rtf = new Intl.RelativeTimeFormat(vocab.locale, { numeric: "auto" })
  if (abs < 45) return rtf.format(0, "second")
  if (abs < 3600) return rtf.format(Math.round(seconds / 60), "minute")
  if (abs < 86400) return rtf.format(Math.round(seconds / 3600), "hour")
  if (abs < 86400 * 30) return rtf.format(Math.round(seconds / 86400), "day")
  return formatDateTime(date, { dateStyle: "medium" })
}

/** Time: relative by default; the absolute value (with zone) is always one hover away. */
export function Time({ value, mode = "relative", className }: { value: DateInput; mode?: "relative" | "datetime" | "date" | undefined; className?: string | undefined }) {
  const date = toDate(value)
  if (date === null) return <span className={cn("text-muted-foreground", className)}>—</span>
  const absolute = formatDateTime(date, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", timeZoneName: "short" })
  const text = mode === "relative" ? formatRelative(date) : mode === "date" ? formatDateTime(date, { dateStyle: "medium" }) : formatDateTime(date)
  return <time dateTime={date.toISOString()} title={absolute} className={cn("tabular-nums whitespace-nowrap", className)}>{text}</time>
}

export function formatNumber(value: number | null | undefined, options?: Intl.NumberFormatOptions): string {
  return value === null || value === undefined || Number.isNaN(value) ? "—" : new Intl.NumberFormat(vocab.locale, options).format(value)
}

export function Num({ value, unit, options, className }: { value: number | null | undefined; unit?: string | undefined; options?: Intl.NumberFormatOptions | undefined; className?: string | undefined }) {
  return <span className={cn("tabular-nums whitespace-nowrap", className)}>{formatNumber(value, options)}{unit !== undefined && value !== null && value !== undefined ? <span className="text-muted-foreground"> {unit}</span> : null}</span>
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || Number.isNaN(bytes)) return "—"
  const units = ["B", "KB", "MB", "GB", "TB"]
  let value = bytes
  let index = 0
  while (Math.abs(value) >= 1024 && index < units.length - 1) { value /= 1024; index += 1 }
  return `${formatNumber(value, { maximumFractionDigits: index === 0 ? 0 : 1 })} ${units[index]}`
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || Number.isNaN(ms)) return "—"
  if (ms < 1000) return `${Math.round(ms)} ms`
  const total = Math.round(ms / 1000)
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60
  return [h ? `${h}h` : "", m ? `${m}m` : "", s || (!h && !m) ? `${s}s` : ""].filter(Boolean).join(" ")
}

/** Identifier: monospace, middle-truncated, full value on hover, one-click copy. */
export function Id({ value, head = 8, tail = 4, copy = true, className }: { value: string; head?: number | undefined; tail?: number | undefined; copy?: boolean | undefined; className?: string | undefined }) {
  const [copied, setCopied] = React.useState(false)
  const short = value.length > head + tail + 1 ? `${value.slice(0, head)}…${tail > 0 ? value.slice(-tail) : ""}` : value
  const onCopy = (event: React.MouseEvent) => {
    event.preventDefault(); event.stopPropagation()
    void navigator.clipboard?.writeText(value).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1200) })
  }
  return (
    <span className={cn("group/id inline-flex", copy && "relative z-10", "max-w-full items-center gap-1 font-mono text-xs text-muted-foreground", className)} title={value}>
      <span className="truncate">{short}</span>
      {copy ? (
        <button type="button" onClick={onCopy} aria-label={copied ? vocab.copy.copied : `${vocab.copy.copy} ${value}`}
          className="-my-1 inline-flex size-6 shrink-0 items-center justify-center rounded-sm opacity-0 transition-opacity group-hover/id:opacity-100 hover:bg-muted focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none">
          {copied ? <CheckIcon className="size-3" /> : <CopyIcon className="size-3" />}
        </button>
      ) : null}
    </span>
  )
}

const CRON_DAYS = ["日", "一", "二", "三", "四", "五", "六"]
/** Human text for common 5-field cron expressions; falls back to the raw expression. */
export function cronToText(expression: string): string {
  const parts = expression.trim().split(/\s+/)
  if (parts.length !== 5) return expression
  const [min = "", hour = "", dom = "", mon = "", dow = ""] = parts
  const at = /^\d+$/.test(min) && /^\d+$/.test(hour) ? `${hour.padStart(2, "0")}:${min.padStart(2, "0")}` : null
  if (at && dom === "*" && mon === "*" && dow === "*") return `每天 ${at}`
  if (at && dom === "*" && mon === "*" && /^[0-6]$/.test(dow)) return `每周${CRON_DAYS[Number(dow)]} ${at}`
  if (at && dom === "*" && mon === "*" && dow === "1-5") return `工作日 ${at}`
  if (at && /^\d+$/.test(dom) && mon === "*" && dow === "*") return `每月 ${dom} 日 ${at}`
  if (/^\*\/(\d+)$/.test(min) && hour === "*" && dom === "*" && mon === "*" && dow === "*") return `每 ${min.slice(2)} 分钟`
  if (min === "0" && /^\*\/(\d+)$/.test(hour) && dom === "*" && mon === "*" && dow === "*") return `每 ${hour.slice(2)} 小时`
  if (min === "0" && hour === "*" && dom === "*" && mon === "*" && dow === "*") return "每小时"
  return expression
}
