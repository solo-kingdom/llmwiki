import { useWikiReader } from "@/context/WikiReaderContext"
import { useT } from "@/i18n"
import type { MessageKey } from "@/i18n"
import { WIKI_PAGE_TYPES, type WikiPageType } from "@/lib/wiki-page-types"
import { cn } from "@/lib/utils"

const TYPE_LABEL_KEYS: Record<WikiPageType, MessageKey> = {
  entity: "wiki.type.entity",
  concept: "wiki.type.concept",
  source: "wiki.type.source",
  synthesis: "wiki.type.synthesis",
  comparison: "wiki.type.comparison",
  query: "wiki.type.query",
}

export function WikiTypeFilter() {
  const t = useT()
  const { selectedPageTypes, setSelectedPageTypes } = useWikiReader()

  const toggle = (type: string) => {
    if (selectedPageTypes.includes(type)) {
      setSelectedPageTypes(selectedPageTypes.filter((x) => x !== type))
    } else {
      setSelectedPageTypes([...selectedPageTypes, type])
    }
  }

  return (
    <div className="border-b px-3 py-2">
      <p className="mb-1.5 text-xs font-medium text-muted-foreground">
        {t("wiki.type_filter")}
      </p>
      <div className="flex flex-wrap gap-1">
        {WIKI_PAGE_TYPES.map((type) => {
          const active = selectedPageTypes.includes(type)
          return (
            <button
              key={type}
              type="button"
              onClick={() => toggle(type)}
              className={cn(
                "rounded-md px-2 py-0.5 text-xs transition-colors",
                active
                  ? "bg-point text-point-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80",
              )}
            >
              {t(TYPE_LABEL_KEYS[type])}
            </button>
          )
        })}
      </div>
    </div>
  )
}
