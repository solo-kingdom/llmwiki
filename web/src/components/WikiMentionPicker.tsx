import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { DocumentListItem, WikiRefPayload } from "@/types"
import { fuzzySearchDocs } from "@/lib/fuzzy-search"
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
  /** 全量文档列表，用于 fzf 模糊匹配 */
  documents?: DocumentListItem[]
  /** textarea 引用，用于监听 @ 输入 */
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>
  /** textarea 当前值 */
  inputValue?: string
  /** 当组件修改 textarea 内容时回调 */
  onInputChange?: (value: string) => void
}

export function WikiMentionPicker({
  value,
  onChange,
  disabled,
  documents = [],
  textareaRef,
  inputValue: _inputValue = "",
  onInputChange,
}: WikiMentionPickerProps) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [mentionStart, setMentionStart] = useState(-1) // position of @ char
  const [searchQuery, setSearchQuery] = useState("")
  const [highlightIndex, setHighlightIndex] = useState(0)
  const panelRef = useRef<HTMLDivElement>(null)

  const selectedIds = useMemo(
    () => new Set(value.map((v) => v.document_id)),
    [value],
  )

  // Filter documents to wiki pages only
  const wikiDocs = useMemo(
    () => documents.filter((d) => d.path?.includes("wiki/")),
    [documents],
  )

  // Fuzzy search results
  const results = useMemo(
    () => fuzzySearchDocs(wikiDocs, searchQuery, 8),
    [wikiDocs, searchQuery],
  )

  const addRef = useCallback(
    (doc: DocumentListItem) => {
      if (selectedIds.has(doc.id)) return
      if (value.length >= MAX_WIKI_REFS) return

      // Remove the @query text from textarea
      if (mentionStart >= 0 && onInputChange && textareaRef?.current) {
        const val = textareaRef.current.value
        const before = val.slice(0, mentionStart)
        const after = val.slice(textareaRef.current.selectionStart)
        onInputChange(before + after)
        // Reset cursor position
        requestAnimationFrame(() => {
          if (textareaRef.current) {
            const newPos = before.length
            textareaRef.current.selectionStart = newPos
            textareaRef.current.selectionEnd = newPos
            textareaRef.current.focus()
          }
        })
      }

      onChange([
        ...value,
        {
          document_id: doc.id,
          relative_path: doc.relative_path ?? doc.path,
          title: doc.title || doc.filename,
        },
      ])
      setOpen(false)
      setMentionStart(-1)
      setSearchQuery("")
      setHighlightIndex(0)
    },
    [onChange, selectedIds, value, mentionStart, onInputChange, textareaRef],
  )

  // Watch textarea input for @ trigger
  useEffect(() => {
    if (!textareaRef?.current) return
    const el = textareaRef.current

    const handleInput = () => {
      const pos = el.selectionStart
      const val = el.value
      if (pos <= 0) return

      // Check if the character just typed is @ and preceded by start/space/newline
      if (val[pos - 1] === "@") {
        const before = pos <= 1 ? "" : val[pos - 2]
        if (before === "" || before === " " || before === "\n") {
          setMentionStart(pos - 1)
          setSearchQuery("")
          setOpen(true)
          return
        }
      }

      // If panel is open, update search query from text after @
      if (open && mentionStart >= 0) {
        const queryText = val.slice(mentionStart + 1, pos)
        if (queryText.includes(" ") || queryText.includes("\n") || val[mentionStart] !== "@") {
          // Closed by space/newline or @ deleted
          setOpen(false)
          setMentionStart(-1)
          setSearchQuery("")
        } else {
          setSearchQuery(queryText)
        }
      }
    }

    el.addEventListener("input", handleInput)
    return () => el.removeEventListener("input", handleInput)
  }, [textareaRef, open, mentionStart])

  // Close on Escape
  useEffect(() => {
    if (!open) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false)
        setMentionStart(-1)
        setSearchQuery("")
        setHighlightIndex(0)
      }
    }
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [open])

  // Keyboard navigation for mention panel (ArrowUp/Down/Enter)
  useEffect(() => {
    if (!open || !textareaRef?.current) return
    const el = textareaRef.current

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault()
        setHighlightIndex((i) => Math.min(i + 1, results.length - 1))
      } else if (e.key === "ArrowUp") {
        e.preventDefault()
        setHighlightIndex((i) => Math.max(i - 1, 0))
      } else if (e.key === "Enter") {
        if (results.length > 0) {
          e.preventDefault()
          addRef(results[highlightIndex])
        }
      }
    }

    el.addEventListener("keydown", handleKeyDown)
    return () => el.removeEventListener("keydown", handleKeyDown)
  }, [open, textareaRef, results, highlightIndex, addRef])

  // Reset highlight index when search query changes
  useEffect(() => {
    setHighlightIndex(0)
  }, [searchQuery])

  // Close on click outside
  useEffect(() => {
    if (!open) return
    const handleClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false)
        setMentionStart(-1)
        setSearchQuery("")
        setHighlightIndex(0)
      }
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [open])

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
      {value.length >= MAX_WIKI_REFS && (
        <p className="text-[11px] text-muted-foreground">
          {t("chat.wiki_mention_limit")}
        </p>
      )}
      {open && (
        <div
          ref={panelRef}
          className="max-h-48 w-full overflow-auto rounded-md border bg-popover p-1 shadow-md"
        >
          {results.length === 0 && (
            <p className="px-2 py-1 text-xs text-muted-foreground">
              {t("chat.wiki_mention_empty")}
            </p>
          )}
          {results.map((doc, idx) => (
            <Button
              key={doc.id}
              type="button"
              variant="ghost"
              size="sm"
              className={`h-auto w-full justify-start whitespace-normal px-2 py-1 text-left text-xs ${idx === highlightIndex ? "bg-accent" : ""}`}
              disabled={selectedIds.has(doc.id)}
              onClick={() => addRef(doc)}
            >
              <span className="font-medium">{doc.title || doc.filename}</span>
              <span className="ml-1 text-muted-foreground">{doc.path}</span>
            </Button>
          ))}
        </div>
      )}
    </div>
  )
}

export { MAX_WIKI_REFS }
