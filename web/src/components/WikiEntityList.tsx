import { useMemo } from "react"
import { useWikiReader } from "@/context/WikiReaderContext"
import { useT } from "@/i18n"
import { inferPageType } from "@/lib/wiki-page-types"
import { cn } from "@/lib/utils"

export function WikiEntityList({ onSelect }: { onSelect?: () => void }) {
  const t = useT()
  const { filteredDocuments, currentDocId, selectDocument, selectedPageTypes } =
    useWikiReader()

  const entities = useMemo(() => {
    const list = filteredDocuments.filter(
      (d) => inferPageType(d) === "entity",
    )
    return list.sort((a, b) =>
      (a.title || a.filename).localeCompare(b.title || b.filename),
    )
  }, [filteredDocuments])

  const showSection =
    selectedPageTypes.length === 0 || selectedPageTypes.includes("entity")

  if (!showSection || entities.length === 0) {
    return null
  }

  return (
    <div className="border-b px-2 py-2">
      <p className="px-1 pb-1 text-xs font-medium text-muted-foreground">
        {t("wiki.entity_list")}
      </p>
      <ul className="max-h-36 overflow-y-auto">
        {entities.map((doc) => (
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
    </div>
  )
}
