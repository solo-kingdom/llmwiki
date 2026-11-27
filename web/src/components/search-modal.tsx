import * as React from "react"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { ArchiveIcon, FileSearchIcon, SearchIcon } from "lucide-react"
import { ErrorState, RowsSkeleton } from "@/components/blocks/state-boundary"
import { StatusBadge } from "@/components/blocks/status-badge"
import { Badge } from "@/components/ui/badge"
import { Command, CommandDialog, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Kbd } from "@/components/ui/kbd"
import { searchArchiveFiles, searchDocuments } from "@/lib/api"
import { WikiFileIcon } from "@/lib/file-icons"
import { buildContentSnippet, splitHighlightSegments } from "@/lib/search-snippet"
import type { ArchiveSearchHit, DocumentListItem, SearchChunk } from "@/types"

function useDebounced<T>(value: T, delay = 220): T {
  const [debounced, setDebounced] = React.useState(value)
  React.useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay)
    return () => window.clearTimeout(timer)
  }, [value, delay])
  return debounced
}

/** Register Cmd/Ctrl+K shortcut to open the page's search modal. */
export function useSearchShortcut(onOpen: () => void) {
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault()
        onOpen()
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [onOpen])
}

function HighlightText({ text, query }: { text: string; query: string }) {
  const segments = React.useMemo(() => splitHighlightSegments(text, query), [text, query])
  return (
    <>
      {segments.map((seg, idx) =>
        seg.match ? (
          <mark key={idx} className="llmwiki-search-mark">
            {seg.text}
          </mark>
        ) : (
          <React.Fragment key={idx}>{seg.text}</React.Fragment>
        ),
      )}
    </>
  )
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const ARCHIVE_MATCH_LABELS: Record<ArchiveSearchHit["match_type"], string> = {
  both: "名称与正文",
  filename: "文件名",
  path: "路径",
  content: "正文命中",
}

const WIKI_TYPE_LABELS: Record<string, string> = {
  concept: "概念",
  entity: "实体",
  experience: "经验",
  ledger: "台账",
  synthesis: "综合",
  comparison: "对比",
  query: "问题",
  page: "普通页面",
  system: "系统",
}

const ARCHIVE_KIND_LABELS: Record<string, string> = {
  markdown: "Markdown",
  html: "HTML",
  image: "图片",
  video: "视频",
  audio: "音频",
  pdf: "PDF",
  text: "文本/代码",
  other: "其他",
}

function SearchModalShell({
  open,
  onOpenChange,
  title,
  description,
  placeholder,
  query,
  onQueryChange,
  scopeBar,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  placeholder: string
  query: string
  onQueryChange: (value: string) => void
  scopeBar: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      className="llmwiki-search-dialog"
    >
      <Command shouldFilter={false} loop className="llmwiki-search-command">
        <CommandInput
          placeholder={placeholder}
          value={query}
          onValueChange={onQueryChange}
          autoFocus
        />
        <div className="llmwiki-search-scope-bar">{scopeBar}</div>
        <CommandList className="llmwiki-search-list">{children}</CommandList>
        <div className="llmwiki-search-footer">
          <div className="llmwiki-search-footer-hints">
            <span className="llmwiki-search-footer-hint">
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd>
              <span>选择</span>
            </span>
            <span className="llmwiki-search-footer-hint">
              <Kbd>↵</Kbd>
              <span>打开</span>
            </span>
            <span className="llmwiki-search-footer-hint">
              <Kbd>Esc</Kbd>
              <span>关闭</span>
            </span>
          </div>
          <span className="llmwiki-search-footer-hint">
            <Kbd>⌘K</Kbd>
            <span>/</span>
            <Kbd>Ctrl K</Kbd>
          </span>
        </div>
      </Command>
    </CommandDialog>
  )
}

function SearchEmptyBlock({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode
  title: string
  description: string
}) {
  return (
    <div className="llmwiki-search-empty">
      <div className="llmwiki-search-empty-icon">{icon}</div>
      <div className="llmwiki-search-empty-title">{title}</div>
      <div className="llmwiki-search-empty-desc">{description}</div>
    </div>
  )
}

const SYSTEM_PAGE_PATHS = new Set(["wiki/overview.md"])

function isSystemHit(hit: SearchChunk): boolean {
  const cleaned = hit.path.replace(/^\/+/, "")
  return SYSTEM_PAGE_PATHS.has(cleaned) || hit.page_type === "system"
}

export function WikiSearchDialog({
  open,
  onOpenChange,
  documents,
  typeFilter,
  onClearTypeFilter,
  showArchived,
  onShowArchivedChange,
  onSelectDocument,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  documents: DocumentListItem[]
  typeFilter: string
  onClearTypeFilter?: () => void
  showArchived: boolean
  onShowArchivedChange?: (value: boolean) => void
  onSelectDocument: (docId: string) => void
}) {
  const [query, setQuery] = React.useState("")
  const handleOpenChange = React.useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) setQuery("")
      onOpenChange(nextOpen)
    },
    [onOpenChange],
  )

  const debounced = useDebounced(query.trim(), 220)
  const search = useQuery({
    queryKey: ["wiki-modal-search", debounced, typeFilter, showArchived],
    queryFn: () =>
      searchDocuments(
        debounced,
        20,
        typeFilter === "all" || typeFilter === "system" ? undefined : [typeFilter],
        undefined,
        { archived: showArchived ? "include" : "exclude" },
      ),
    enabled: open && debounced.length > 0,
    placeholderData: keepPreviousData,
  })

  const docById = React.useMemo(() => new Map(documents.map((d) => [d.id, d])), [documents])
  const hits = React.useMemo(() => {
    const raw = search.data?.results ?? []
    return raw.filter((hit) => (typeFilter === "system" ? isSystemHit(hit) : !isSystemHit(hit)))
  }, [search.data?.results, typeFilter])

  const hasQuery = query.trim().length > 0
  const searching = debounced.length > 0

  return (
    <SearchModalShell
      open={open}
      onOpenChange={handleOpenChange}
      title="搜索 Wiki"
      description="按标题、路径或文档正文内容检索 Wiki 页面"
      placeholder="搜索 Wiki 标题、路径或正文内容…"
      query={query}
      onQueryChange={setQuery}
      scopeBar={
        <>
          <div className="llmwiki-search-scope-group">
            <span className="llmwiki-search-scope-pill">Wiki 知识库</span>
            {typeFilter !== "all" && (
              <button
                type="button"
                className="llmwiki-search-scope-action"
                onClick={onClearTypeFilter}
                title="点击恢复全部类型"
              >
                类型：{WIKI_TYPE_LABELS[typeFilter] ?? typeFilter} ×
              </button>
            )}
            {onShowArchivedChange && (
              <button
                type="button"
                className="llmwiki-search-scope-action"
                data-active={showArchived ? "true" : "false"}
                onClick={() => onShowArchivedChange(!showArchived)}
              >
                <ArchiveIcon className="size-3" />
                <span>{showArchived ? "已含归档" : "含已归档"}</span>
              </button>
            )}
          </div>
          <span>
            {searching && !search.isFetching ? `${hits.length} 条结果` : "标题 · 路径 · 正文"}
          </span>
        </>
      }
    >
      {!hasQuery ? (
        <SearchEmptyBlock
          icon={<SearchIcon />}
          title="输入关键词搜索 Wiki"
          description="支持页面标题、目录路径、别名及正文内容的全文与语义检索"
        />
      ) : search.isError ? (
        <ErrorState error={search.error} onRetry={() => void search.refetch()} />
      ) : search.isLoading || (search.isFetching && hits.length === 0) ? (
        <RowsSkeleton rows={4} />
      ) : hits.length === 0 ? (
        <SearchEmptyBlock
          icon={<FileSearchIcon />}
          title="没有匹配的 Wiki 页面"
          description={`未找到包含“${debounced}”的标题、路径或正文内容`}
        />
      ) : (
        hits.map((hit) => {
          const docMeta = docById.get(hit.document_id)
          const title = hit.title || docMeta?.title || hit.filename
          const pageType = hit.page_type || docMeta?.page_type || "page"
          const pathLabel = hit.path.replace(/^\/+/, "")
          const subtitle = hit.header_breadcrumb ? `${pathLabel} · ${hit.header_breadcrumb}` : pathLabel
          const snippet = buildContentSnippet(hit.content, debounced, 180)
          return (
            <CommandItem
              key={`${hit.document_id}-${hit.chunk_index}`}
              value={`${hit.document_id} ${title} ${pathLabel}`}
              className="llmwiki-search-item"
              onSelect={() => {
                handleOpenChange(false)
                onSelectDocument(hit.document_id)
              }}
            >
              <span className="llmwiki-search-item-icon">
                <WikiFileIcon doc={{ filename: hit.filename, page_type: pageType, relative_path: pathLabel }} />
              </span>
              <div className="llmwiki-search-item-body">
                <div className="llmwiki-search-item-head">
                  <span className="llmwiki-search-item-title">
                    <HighlightText text={title} query={debounced} />
                  </span>
                  <div className="llmwiki-search-item-badges">
                    {hit.archived_at ? <Badge variant="outline">已归档</Badge> : null}
                    {hit.match_type === "semantic" ? <Badge variant="secondary">语义</Badge> : null}
                    <StatusBadge status={pageType} />
                  </div>
                </div>
                <div className="llmwiki-search-item-path">
                  <HighlightText text={subtitle} query={debounced} />
                </div>
                {snippet ? (
                  <div className="llmwiki-search-snippet">
                    <HighlightText text={snippet} query={debounced} />
                  </div>
                ) : null}
              </div>
            </CommandItem>
          )
        })
      )}
    </SearchModalShell>
  )
}

export function ArchiveSearchDialog({
  open,
  onOpenChange,
  kindFilter,
  onClearKindFilter,
  onSelectFile,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  kindFilter: string
  onClearKindFilter?: () => void
  onSelectFile: (fileId: string) => void
}) {
  const [query, setQuery] = React.useState("")
  const handleOpenChange = React.useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) setQuery("")
      onOpenChange(nextOpen)
    },
    [onOpenChange],
  )

  const debounced = useDebounced(query.trim(), 220)
  const search = useQuery({
    queryKey: ["archive-modal-search", debounced, kindFilter],
    queryFn: () => searchArchiveFiles({ q: debounced, kind: kindFilter, limit: 20 }),
    enabled: open && debounced.length > 0,
    placeholderData: keepPreviousData,
  })

  const hits = search.data?.results ?? []
  const hasQuery = query.trim().length > 0
  const searching = debounced.length > 0

  return (
    <SearchModalShell
      open={open}
      onOpenChange={handleOpenChange}
      title="搜索档案"
      description="按文件名、目录路径或文本类文档正文内容检索档案文件"
      placeholder="搜索档案文件名、路径或文档正文…"
      query={query}
      onQueryChange={setQuery}
      scopeBar={
        <>
          <div className="llmwiki-search-scope-group">
            <span className="llmwiki-search-scope-pill">档案文件</span>
            {kindFilter !== "all" && (
              <button
                type="button"
                className="llmwiki-search-scope-action"
                onClick={onClearKindFilter}
                title="点击恢复全部类型"
              >
                类型：{ARCHIVE_KIND_LABELS[kindFilter] ?? kindFilter} ×
              </button>
            )}
          </div>
          <span>
            {searching && !search.isFetching ? `${hits.length} 条结果` : "文件名 · 路径 · 文本正文"}
          </span>
        </>
      }
    >
      {!hasQuery ? (
        <SearchEmptyBlock
          icon={<SearchIcon />}
          title="输入关键词搜索档案"
          description="支持按文件名、路径，以及 Markdown / HTML / 纯文本与代码正文检索"
        />
      ) : search.isError ? (
        <ErrorState error={search.error} onRetry={() => void search.refetch()} />
      ) : search.isLoading || (search.isFetching && hits.length === 0) ? (
        <RowsSkeleton rows={4} />
      ) : hits.length === 0 ? (
        <SearchEmptyBlock
          icon={<FileSearchIcon />}
          title="没有匹配的档案文件"
          description={`未找到包含“${debounced}”的文件名、路径或正文内容`}
        />
      ) : (
        hits.map((hit) => {
          const { file } = hit
          return (
            <CommandItem
              key={file.id}
              value={`${file.id} ${file.filename} ${file.relative_path}`}
              className="llmwiki-search-item"
              onSelect={() => {
                handleOpenChange(false)
                onSelectFile(file.id)
              }}
            >
              <span className="llmwiki-search-item-icon">
                <WikiFileIcon doc={file} />
              </span>
              <div className="llmwiki-search-item-body">
                <div className="llmwiki-search-item-head">
                  <span className="llmwiki-search-item-title">
                    <HighlightText text={file.filename} query={debounced} />
                  </span>
                  <div className="llmwiki-search-item-badges">
                    <Badge variant="secondary">{ARCHIVE_MATCH_LABELS[hit.match_type]}</Badge>
                    <Badge variant="outline">{formatSize(file.size)}</Badge>
                  </div>
                </div>
                <div className="llmwiki-search-item-path">
                  <HighlightText text={file.relative_path} query={debounced} />
                </div>
                {hit.snippet ? (
                  <div className="llmwiki-search-snippet">
                    <HighlightText text={hit.snippet} query={debounced} />
                  </div>
                ) : null}
              </div>
            </CommandItem>
          )
        })
      )}
    </SearchModalShell>
  )
}
