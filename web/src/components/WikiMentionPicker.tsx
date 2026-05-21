import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { searchDocuments } from "@/lib/api"
import type { SearchChunk, WikiRefPayload } from "@/types"
import { Button } from "@/components/ui/button"
import { useT } from "@/i18n"
import { X } from "lucide-react"

const MAX_WIKI_REFS = 5

export function parseWikiRefsJSON(raw?: string): WikiRefPayload[] {
  if (!raw?.trim() || raw.trim() === "[]") return []
  try {
    const parsed = JSON.parse(raw) as WikiRefPayload[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

interface WikiMentionPickerProps {
  value: WikiRefPayload[]
  onChange: (refs: WikiRefPayload[]) => void
  disabled?: boolean
}

export function WikiMentionPicker({
  value,
  onChange,
  disabled,
}: WikiMentionPickerProps) {
  const t = useT()
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<SearchChunk[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const selectedIds = useMemo(
    () => new Set(value.map((v) => v.document_id)),
    [value],
  )

  useEffect(() => {
    if (!open || query.trim().length < 1) {
      setResults([])
      return
    }
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setLoading(true)
      void searchDocuments(query.trim(), 8)
        .then((resp) => {
          const wikiOnly = resp.results.filter((r) =>
            r.path?.includes("wiki/"),
          )
          setResults(wikiOnly)
        })
        .catch(() => setResults([]))
        .finally(() => setLoading(false))
    }, 200)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query, open])

  const addRef = useCallback(
    (doc: SearchChunk) => {
      if (selectedIds.has(doc.document_id)) return
      if (value.length >= MAX_WIKI_REFS) return
      onChange([
        ...value,
        {
          document_id: doc.document_id,
          relative_path: doc.path,
          title: doc.title || doc.filename,
        },
      ])
      setQuery("")
      setOpen(false)
    },
    [onChange, selectedIds, value],
  )

  const removeRef = (id: string) => {
    onChange(value.filter((v) => v.document_id !== id))
  }

  return (
    <div className="space-y-2 px-2">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((ref) => (
            <span
              key={ref.document_id}
              className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs"
            >
              @{ref.title || ref.relative_path}
              <button
                type="button"
                className="rounded p-0.5 hover:bg-background/60"
                aria-label="remove"
                disabled={disabled}
                onClick={() => removeRef(ref.document_id)}
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="relative">
        <input
          className="w-full rounded-md border border-border/60 bg-background px-2 py-1 text-xs outline-none"
          placeholder={t("chat.wiki_mention_placeholder")}
          value={query}
          disabled={disabled || value.length >= MAX_WIKI_REFS}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false)
          }}
        />
        {value.length >= MAX_WIKI_REFS && (
          <p className="mt-1 text-[11px] text-muted-foreground">
            {t("chat.wiki_mention_limit")}
          </p>
        )}
        {open && query.trim() && (
          <div className="absolute bottom-full z-20 mb-1 max-h-48 w-full overflow-auto rounded-md border bg-popover p-1 shadow-md">
            {loading && (
              <p className="px-2 py-1 text-xs text-muted-foreground">...</p>
            )}
            {!loading && results.length === 0 && (
              <p className="px-2 py-1 text-xs text-muted-foreground">
                {t("chat.wiki_mention_empty")}
              </p>
            )}
            {results.map((doc) => (
              <Button
                key={doc.document_id}
                type="button"
                variant="ghost"
                size="sm"
                className="h-auto w-full justify-start whitespace-normal px-2 py-1 text-left text-xs"
                disabled={selectedIds.has(doc.document_id)}
                onClick={() => addRef(doc)}
              >
                <span className="font-medium">{doc.title || doc.filename}</span>
                <span className="ml-1 text-muted-foreground">{doc.path}</span>
              </Button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export { MAX_WIKI_REFS }
