import { useState, useCallback, useEffect, useRef, useMemo } from "react"
import {
  Search,
  X,
  FileText,
  Loader2,
  Clock,
  Trash2,
  ArrowRight,
} from "lucide-react"
import { Dialog } from "@base-ui/react/dialog"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { cn, getSearchHistory, saveSearchHistory, clearSearchHistory } from "@/lib/utils"
import { highlightText } from "@/lib/search-highlight"
import { useWikiReader } from "@/context/WikiReaderContext"
import { WikiTypeFilter } from "@/components/WikiTypeFilter"
import { useT } from "@/i18n"
import type { SearchChunk } from "@/types"

interface SearchModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SearchModal({ open, onOpenChange }: SearchModalProps) {
  const t = useT()
  const {
    search,
    searchResults,
    searchQuery,
    clearSearch,
    selectDocument,
    selectedPageTypes,
  } = useWikiReader()
  const [query, setQuery] = useState("")
  const [loading, setLoading] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(-1)
  const [history, setHistory] = useState<string[]>([])
  const [showHistory, setShowHistory] = useState(true)
  const inputRef = useRef<HTMLInputElement>(null)
  const resultsRef = useRef<HTMLDivElement>(null)
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (open) {
      setHistory(getSearchHistory())
      setShowHistory(true)
      const t = window.setTimeout(() => inputRef.current?.focus(), 100)
      return () => window.clearTimeout(t)
    }
    setQuery("")
    clearSearch()
    setSelectedIndex(-1)
  }, [open, clearSearch])

  useEffect(() => {
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    if (!searchResults) {
      setLoading(false)
      return
    }
    setLoading(false)
    if (searchResults.results.length > 0) {
      setSelectedIndex(0)
    }
  }, [open, searchResults])

  const runSearch = useCallback(
    (q: string) => {
      if (!q.trim()) return
      setLoading(true)
      const types =
        selectedPageTypes.length > 0 ? selectedPageTypes : undefined
      search(q, types)
    },
    [search, selectedPageTypes],
  )

  const handleInputChange = (value: string) => {
    setQuery(value)
    setSelectedIndex(-1)
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    if (!value.trim()) {
      clearSearch()
      setShowHistory(true)
      setLoading(false)
      return
    }
    setShowHistory(false)
    searchTimerRef.current = setTimeout(() => runSearch(value), 300)
  }

  const handleSelect = useCallback(
    (chunk: SearchChunk) => {
      if (query.trim()) saveSearchHistory(query.trim())
      if (chunk.document_id) {
        selectDocument(chunk.document_id)
      }
      onOpenChange(false)
    },
    [query, selectDocument, onOpenChange],
  )

  const handleClear = () => {
    setQuery("")
    clearSearch()
    setShowHistory(true)
    setLoading(false)
    inputRef.current?.focus()
  }

  const handleHistoryClick = (item: string) => {
    setQuery(item)
    setShowHistory(false)
    runSearch(item)
  }

  const handleClearHistory = () => {
    clearSearchHistory()
    setHistory([])
  }

  const results = searchResults?.results ?? []
  const itemsCount = showHistory && !query ? history.length : results.length

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault()
        setSelectedIndex((prev) => (prev < itemsCount - 1 ? prev + 1 : 0))
        break
      case "ArrowUp":
        e.preventDefault()
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : itemsCount - 1))
        break
      case "Enter":
        e.preventDefault()
        if (showHistory && !query && history[selectedIndex]) {
          handleHistoryClick(history[selectedIndex])
        } else if (results[selectedIndex]) {
          handleSelect(results[selectedIndex])
        } else if (results[0]) {
          handleSelect(results[0])
        }
        break
      case "Escape":
        e.preventDefault()
        onOpenChange(false)
        break
    }
  }

  useEffect(() => {
    if (selectedIndex < 0 || !resultsRef.current) return
    const el = resultsRef.current.querySelector(`[data-index="${selectedIndex}"]`)
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ block: "nearest", behavior: "smooth" })
    }
  }, [selectedIndex])

  const isMac = useMemo(
    () =>
      typeof navigator !== "undefined" &&
      navigator.platform.toUpperCase().includes("MAC"),
    [],
  )

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm" />
        <Dialog.Popup className="fixed left-1/2 top-[12vh] z-50 flex w-[min(42rem,90vw)] max-h-[70vh] -translate-x-1/2 flex-col overflow-hidden rounded-xl border bg-background shadow-2xl">
          <div className="flex shrink-0 items-center px-4 py-3">
            <Search className="h-5 w-5 shrink-0 text-muted-foreground" />
            <Input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => handleInputChange(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t("search.placeholder")}
              className="flex-1 border-0 bg-transparent px-3 text-base shadow-none focus-visible:ring-0"
              autoComplete="off"
              spellCheck={false}
            />
            {loading ? (
              <Loader2 className="h-5 w-5 shrink-0 animate-spin text-muted-foreground" />
            ) : (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0"
                onClick={() => (query ? handleClear() : onOpenChange(false))}
                title={query ? t("common.clear") : t("common.close")}
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
          <WikiTypeFilter />
          <Separator />

          <div ref={resultsRef} className="min-h-0 flex-1 overflow-y-auto">
            {showHistory && !query && history.length > 0 && (
              <div className="py-2">
                <div className="flex items-center justify-between px-4 py-1.5">
                  <span className="text-xs font-medium text-muted-foreground">
                    {t("search.recent")}
                  </span>
                  <Button
                    variant="ghost"
                    className="h-auto px-2 py-1 text-xs"
                    onClick={handleClearHistory}
                  >
                    <Trash2 className="h-3 w-3" />
                    {t("common.clear")}
                  </Button>
                </div>
                {history.map((item, index) => (
                  <button
                    key={item}
                    type="button"
                    data-index={index}
                    className={cn(
                      "flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-muted/60",
                      selectedIndex === index && "bg-muted/60",
                    )}
                    onClick={() => handleHistoryClick(item)}
                  >
                    <Clock className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="flex-1 text-sm">{item}</span>
                    <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/50" />
                  </button>
                ))}
              </div>
            )}

            {!query && history.length === 0 && (
              <div className="py-16 text-center">
                <Search className="mx-auto mb-4 h-12 w-12 text-muted-foreground/20" />
                <p className="text-sm text-muted-foreground">{t("search.hint")}</p>
                <p className="mt-1 text-xs text-muted-foreground/60">
                  {t("search.hint_sub")}
                </p>
              </div>
            )}

            {query && loading && (
              <div className="py-16 text-center">
                <Loader2 className="mx-auto mb-3 h-8 w-8 animate-spin text-muted-foreground" />
                <p className="text-sm text-muted-foreground">{t("search.searching")}</p>
              </div>
            )}

            {query && !loading && results.length === 0 && searchQuery && (
              <div className="py-16 text-center">
                <FileText className="mx-auto mb-4 h-12 w-12 text-muted-foreground/20" />
                <p className="text-sm text-muted-foreground">{t("search.no_results")}</p>
              </div>
            )}

            {query && !loading && results.length > 0 && (
              <div className="py-2">
                <div className="px-4 py-1.5 text-xs text-muted-foreground">
                  {t("search.results", { count: results.length })}
                </div>
                <Separator className="bg-border/50" />
                {results.map((result, index) => (
                  <button
                    key={`${result.document_id}-${result.chunk_index}-${index}`}
                    type="button"
                    data-index={index}
                    className={cn(
                      "w-full px-4 py-3 text-left transition-colors hover:bg-muted/60",
                      selectedIndex === index && "bg-muted/60",
                    )}
                    onClick={() => handleSelect(result)}
                  >
                    <div className="flex items-start gap-3">
                      <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium">
                          {highlightText(result.title || result.filename, query)}
                        </div>
                        <div className="mt-0.5 truncate text-xs text-muted-foreground">
                          {highlightText(result.path, query)}
                        </div>
                        <p className="mt-2 line-clamp-2 border-l-2 border-border pl-2 text-xs text-muted-foreground">
                          {highlightText(
                            result.content.slice(0, 150),
                            query,
                          )}
                        </p>
                      </div>
                      {selectedIndex === index && (
                        <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/50" />
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex shrink-0 items-center justify-between border-t bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1">
                <kbd className="rounded border bg-background px-1.5 py-0.5 text-[10px]">
                  ↑↓
                </kbd>
                {t("search.navigate")}
              </span>
              <span className="flex items-center gap-1">
                <kbd className="rounded border bg-background px-1.5 py-0.5 text-[10px]">
                  ↵
                </kbd>
                {t("search.open")}
              </span>
              <span className="flex items-center gap-1">
                <kbd className="rounded border bg-background px-1.5 py-0.5 text-[10px]">
                  Esc
                </kbd>
                {t("common.close")}
              </span>
            </div>
            <span className="hidden items-center gap-1 sm:flex">
              <kbd className="rounded border bg-background px-1.5 py-0.5 text-[10px]">
                {isMac ? "⌘" : "Ctrl"}
              </kbd>
              <kbd className="rounded border bg-background px-1.5 py-0.5 text-[10px]">
                K
              </kbd>
              {t("search.quick")}
            </span>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
