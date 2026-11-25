import * as React from "react"
import { FileTextIcon } from "lucide-react"
import { cn } from "cn"
import type { ArchiveSourceSummary, ReferenceEntry } from "@/types"

/** 参考资料 — structured reference entries rendered after the page body.
 * Related entries flow as quiet pills; source entries read as rows because
 * their annotations are usually longer. Unresolved targets stay visible but
 * muted and non-clickable. */

const COLLAPSE_AFTER = 12

const LABELS = {
  title: { zh: "参考资料", en: "References" },
  related: { zh: "相关", en: "Related" },
  sources: { zh: "来源", en: "Sources" },
  expand: { zh: "展开", en: "Show all" },
} as const

type Lang = "zh" | "en"

function Pill({
  label,
  annotation,
  onClick,
}: {
  label: string
  annotation: string
  onClick?: (() => void) | undefined
}) {
  const clickable = onClick !== undefined
  return (
    <span className="inline-flex max-w-full items-baseline gap-1.5">
      <button
        type="button"
        disabled={!clickable}
        onClick={onClick}
        title={clickable ? label : `${label}（未链接）`}
        className={cn(
          "inline-flex max-w-56 shrink items-center truncate rounded-full border px-2.5 py-0.5 text-xs transition-colors",
          clickable
            ? "cursor-pointer border-border/70 text-foreground/85 hover:border-primary/45 hover:text-primary"
            : "cursor-default border-dashed border-border/50 text-muted-foreground",
        )}
      >
        {label}
      </button>
      {annotation !== "" && (
        <span className="min-w-0 truncate text-xs text-muted-foreground/80">{annotation}</span>
      )}
    </span>
  )
}

function Group({
  label,
  count,
  children,
}: {
  label: string
  count: number
  children: React.ReactNode
}) {
  if (count === 0) return null
  return (
    <div className="space-y-1.5">
      <div className="text-[0.68rem] font-medium tracking-wide text-muted-foreground/70">
        {label} <span className="tabular-nums opacity-70">{count}</span>
      </div>
      {children}
    </div>
  )
}

export function ReferencesBlock({
  entries,
  archiveSources = [],
  lang,
  onOpen,
  onOpenArchive,
}: {
  entries: ReferenceEntry[]
  archiveSources?: ArchiveSourceSummary[]
  lang: Lang
  onOpen: (docId: string) => void
  onOpenArchive?: (archiveId: string) => void
}) {
  const [expanded, setExpanded] = React.useState(false)
  const related = entries.filter((entry) => entry.kind === "related")
  const sources = entries.filter((entry) => entry.kind === "source")
  if (related.length + sources.length + archiveSources.length === 0) return null

  const overflow = Math.max(0, related.length - COLLAPSE_AFTER)
  const shownRelated = expanded ? related : related.slice(0, COLLAPSE_AFTER)

  return (
    <div className="mt-8 space-y-4 border-t border-border/60 pt-4" data-prose-ignore>
      <div className="text-[0.68rem] font-medium tracking-wide text-muted-foreground/70">
        {LABELS.title[lang]}
      </div>
      <Group label={LABELS.related[lang]} count={related.length}>
        <div className="flex flex-wrap gap-x-3 gap-y-1.5">
          {shownRelated.map((entry, index) => (
            <Pill
              key={`${entry.raw_text}-${index}`}
              label={entry.target_title || entry.raw_text}
              annotation={entry.annotation}
              onClick={entry.target_document_id ? () => onOpen(entry.target_document_id) : undefined}
            />
          ))}
          {overflow > 0 && !expanded && (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="rounded-full px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              ＋{overflow} {LABELS.expand[lang]}
            </button>
          )}
        </div>
      </Group>
      <Group label={LABELS.sources[lang]} count={sources.length + archiveSources.length}>
        <ul className="space-y-1">
          {archiveSources.map((src) => (
            <li key={`archive-${src.id}`} className="flex min-w-0 items-center gap-1.5 text-xs">
              <FileTextIcon className="size-3.5 shrink-0 text-muted-foreground" />
              <button
                type="button"
                onClick={() => onOpenArchive?.(src.id)}
                title={src.relative_path}
                className="min-w-0 shrink-0 max-w-full truncate text-primary/90 transition-colors hover:text-primary"
              >
                {src.relative_path}
              </button>
              <span className="min-w-0 truncate text-muted-foreground/80">
                档案源文件 · {src.kind}
              </span>
            </li>
          ))}
          {sources.map((entry, index) => (
            <li key={`${entry.raw_text}-${index}`} className="flex min-w-0 items-baseline gap-1.5 text-xs">
              {entry.target_document_id ? (
                <button
                  type="button"
                  onClick={() => onOpen(entry.target_document_id)}
                  className="min-w-0 shrink-0 max-w-full truncate text-primary/90 transition-colors hover:text-primary"
                >
                  {entry.target_title || entry.raw_text}
                </button>
              ) : (
                <span className="min-w-0 truncate text-muted-foreground">
                  {entry.annotation !== "" ? `${entry.annotation} · ${entry.raw_text}` : entry.raw_text}
                </span>
              )}
              {entry.annotation !== "" && entry.target_document_id !== "" && (
                <span className="min-w-0 truncate text-muted-foreground/80">{entry.annotation}</span>
              )}
            </li>
          ))}
        </ul>
      </Group>
    </div>
  )
}
