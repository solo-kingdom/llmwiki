import { useMemo, useState } from "react"
import { useWikiReader } from "@/context/WikiReaderContext"
import { useT } from "@/i18n"
import { inferPageType, CONCEPT_MODE_TYPES } from "@/lib/wiki-page-types"
import { cn } from "@/lib/utils"

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("shrink-0 transition-transform", !open && "-rotate-90")}
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  )
}

/** A concept-mode flat list showing entity, concept, and overview documents. */
export function WikiEntityList({ onSelect }: { onSelect?: () => void }) {
  const t = useT()
  const { filteredDocuments, currentDocId, selectDocument, selectedPageTypes } =
    useWikiReader()
  const [open, setOpen] = useState(true)

  const items = useMemo(() => {
    return filteredDocuments
      .filter((d) => {
        const pt = inferPageType(d)
        return CONCEPT_MODE_TYPES.includes(pt) || d.page_type === "overview"
      })
      .sort((a, b) =>
        (a.title || a.filename).localeCompare(b.title || b.filename),
      )
  }, [filteredDocuments])

  if (items.length === 0) {
    return null
  }

  return (
    <div className="shrink-0 border-b px-2 py-2">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-1 rounded px-1 py-0.5 text-xs font-medium text-muted-foreground hover:bg-muted cursor-pointer"
      >
        <ChevronIcon open={open} />
        {t("wiki.entity_list")}
        <span className="ml-auto tabular-nums">{items.length}</span>
      </button>
      {open && (
        <ul className="mt-1">
          {items.map((doc) => (
            <li key={doc.id}>
              <button
                type="button"
                onClick={() => {
                  selectDocument(doc.id)
                  onSelect?.()
                }}
                className={cn(
                  "w-full truncate rounded px-2 py-1 text-left text-sm hover:bg-muted",
                  currentDocId === doc.id && "bg-muted font-medium",
                )}
                title={doc.title || doc.filename}
              >
                {doc.title || doc.filename}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
