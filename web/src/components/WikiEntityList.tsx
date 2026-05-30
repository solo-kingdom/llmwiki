import { useMemo, useState } from "react"
import { useWikiReader } from "@/context/WikiReaderContext"
import { useT } from "@/i18n"
import { inferPageType } from "@/lib/wiki-page-types"
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

interface DocItem {
  id: string
  title: string
  filename: string
}

/** A single collapsible group section. */
function DocGroup({
  title,
  items,
  currentDocId,
  onSelectDoc,
  onSelect,
}: {
  title: string
  items: DocItem[]
  currentDocId: string | null
  onSelectDoc: (id: string) => void
  onSelect?: () => void
}) {
  const [open, setOpen] = useState(true)

  if (items.length === 0) return null

  return (
    <div className="shrink-0 border-b px-2 py-2">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-1 rounded px-1 py-0.5 text-xs font-medium text-muted-foreground hover:bg-muted cursor-pointer"
      >
        <ChevronIcon open={open} />
        {title}
        <span className="ml-auto tabular-nums">{items.length}</span>
      </button>
      {open && (
        <ul className="mt-1">
          {items.map((doc) => (
            <li key={doc.id}>
              <button
                type="button"
                onClick={() => {
                  onSelectDoc(doc.id)
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

/** A Wiki-mode grouped list showing entities and concepts as separate sections. */
export function WikiEntityList({ onSelect }: { onSelect?: () => void }) {
  const t = useT()
  const { filteredDocuments, currentDocId, selectDocument } = useWikiReader()

  const { entities, concepts } = useMemo(() => {
    const entities: DocItem[] = []
    const concepts: DocItem[] = []

    for (const d of filteredDocuments) {
      const pt = inferPageType(d)
      const item: DocItem = { id: d.id, title: d.title || "", filename: d.filename }

      if (pt === "entity" || d.page_type === "overview") {
        entities.push(item)
      } else if (pt === "concept") {
        concepts.push(item)
      }
    }

    // Sort each group alphabetically
    const sortFn = (a: DocItem, b: DocItem) =>
      (a.title || a.filename).localeCompare(b.title || b.filename)
    entities.sort(sortFn)
    concepts.sort(sortFn)

    return { entities, concepts }
  }, [filteredDocuments])

  if (entities.length === 0 && concepts.length === 0) {
    return null
  }

  return (
    <>
      <DocGroup
        title={t("wiki.entity_section")}
        items={entities}
        currentDocId={currentDocId}
        onSelectDoc={selectDocument}
        onSelect={onSelect}
      />
      <DocGroup
        title={t("wiki.concept_section")}
        items={concepts}
        currentDocId={currentDocId}
        onSelectDoc={selectDocument}
        onSelect={onSelect}
      />
    </>
  )
}
