import { useState, useCallback, useRef, useEffect } from "react"
import { useApp } from "@/context/AppContext"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"

export function SearchBar() {
  const { search, searchResults, searchQuery, clearSearch } = useApp()
  const [input, setInput] = useState("")
  const [showResults, setShowResults] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const containerRef = useRef<HTMLDivElement>(null)

  const handleInput = useCallback(
    (value: string) => {
      setInput(value)
      if (debounceRef.current) clearTimeout(debounceRef.current)
      if (!value.trim()) {
        clearSearch()
        setShowResults(false)
        return
      }
      debounceRef.current = setTimeout(() => {
        search(value)
        setShowResults(true)
      }, 300)
    },
    [search, clearSearch],
  )

  const handleSelect = useCallback(
    (filename: string) => {
      setShowResults(false)
      setInput("")
      clearSearch()
      const docs = document.querySelectorAll('[data-doc-name]')
      for (const el of docs) {
        if ((el as HTMLElement).dataset.docName === filename) {
          ;(el as HTMLElement).click()
          return
        }
      }
    },
    [clearSearch],
  )

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setShowResults(false)
      }
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [])

  return (
    <div ref={containerRef} className="relative w-full">
      <Input
        type="text"
        placeholder="Search documents..."
        value={input}
        onChange={(e) => handleInput(e.target.value)}
        onFocus={() => searchResults && setShowResults(true)}
        className="h-8 text-sm"
      />
      {showResults && searchResults && searchResults.results.length > 0 && (
        <div className="absolute top-full left-0 z-50 mt-1 min-w-full rounded-lg border bg-popover shadow-lg">
          <ScrollArea className="max-h-80">
            <div className="py-1">
              {searchResults.results.map((chunk, i) => (
                <button
                  key={`${chunk.filename}-${chunk.chunk_index}-${i}`}
                  className="flex w-full flex-col gap-1 px-3 py-2 text-left hover:bg-muted cursor-pointer"
                  onClick={() => handleSelect(chunk.filename)}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium truncate">
                      {chunk.title || chunk.filename}
                    </span>
                    <span className="text-xs text-muted-foreground shrink-0">
                      score: {chunk.score.toFixed(2)}
                    </span>
                  </div>
                  {chunk.header_breadcrumb && (
                    <span className="text-xs text-muted-foreground">
                      {chunk.header_breadcrumb}
                    </span>
                  )}
                  <p className="text-xs text-muted-foreground line-clamp-2">
                    {chunk.content.slice(0, 150)}...
                  </p>
                </button>
              ))}
            </div>
          </ScrollArea>
        </div>
      )}
      {showResults &&
        searchResults &&
        searchResults.results.length === 0 && (
          <div className="absolute top-full left-0 z-50 mt-1 min-w-full rounded-lg border bg-popover p-3 shadow-lg">
            <p className="text-sm text-muted-foreground">
              No results for "{searchQuery}"
            </p>
          </div>
        )}
    </div>
  )
}
