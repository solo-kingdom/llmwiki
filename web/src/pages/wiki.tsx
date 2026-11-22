import * as React from "react"
import { useParams } from "react-router"
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ChevronDownIcon, ChevronRightIcon, ExternalLinkIcon, FoldVerticalIcon, HistoryIcon, InfoIcon, Link2Icon, ListTreeIcon, LocateFixedIcon, RotateCcwIcon, SearchIcon, UnfoldVerticalIcon } from "lucide-react"
import { Markdown } from "@/components/blocks/markdown"
import { useAppNavigate } from "@/components/blocks/router"
import { Body, NavItem, NavList, Page, Panel, Row, Rows, Split, Stack, Toolbar } from "@/components/blocks/surfaces"
import { StatusBadge } from "@/components/blocks/status-badge"
import { EmptyState, ErrorState, RowsSkeleton } from "@/components/blocks/state-boundary"
import { Time } from "@/components/blocks/format"
import { useConfirm } from "@/components/blocks/confirm"
import { notify } from "@/components/blocks/notify"
import { useContainerWidth } from "@/components/blocks/use-container-width"
import { useApp } from "@/context/app-context"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import {
  getBacklinks,
  getDocument,
  getForwardReferences,
  listDocuments,
  listPageHistory,
  restoreRevision,
  searchDocuments,
} from "@/lib/api"
import type { DocumentListItem } from "@/types"

function useDebounced<T>(value: T, delay = 280): T {
  const [debounced, setDebounced] = React.useState(value)
  React.useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay)
    return () => window.clearTimeout(timer)
  }, [value, delay])
  return debounced
}

function pageTypeOf(doc: { relative_path?: string | undefined; path?: string | undefined; page_type?: string | undefined }): string {
  if (doc.page_type) return doc.page_type
  const subdir = (doc.relative_path ?? doc.path ?? "").replace(/^\/+/, "").split("/")[1] ?? ""
  return ({ entities: "entity", concepts: "concept", sources: "source", synthesis: "synthesis", comparisons: "comparison", queries: "query" } as Record<string, string>)[subdir] ?? "page"
}

type TreeNode = { key: string; segment: string; doc?: DocumentListItem; children?: TreeNode[] }
type TreeModel = { nodes: TreeNode[]; folderKeys: string[]; ancestors: Map<string, string[]> }

const FOLDER_LABELS: Record<string, { zh: string; en: string }> = {
  concepts: { zh: "概念", en: "Concepts" },
  entities: { zh: "实体", en: "Entities" },
  other: { zh: "其他", en: "Other" },
  sources: { zh: "来源", en: "Sources" },
  synthesis: { zh: "综合", en: "Synthesis" },
  comparisons: { zh: "对比", en: "Comparisons" },
  queries: { zh: "问题", en: "Queries" },
  sessions: { zh: "会话", en: "Sessions" },
  "web-ingest": { zh: "网页抓取", en: "Web ingest" },
  archive: { zh: "归档", en: "Archive" },
}

function folderLabel(segment: string, lang: "zh" | "en"): string {
  const entry = FOLDER_LABELS[segment.toLowerCase()]
  return entry === undefined ? segment : lang === "en" ? entry.en : entry.zh
}

/** Page path hoisted so the first tree level is always 概念 / 实体 / 其他. */
function treeSegments(doc: DocumentListItem): string[] {
  const segments = (doc.relative_path ?? doc.path ?? doc.filename).replace(/\.md$/i, "").split("/").filter((part) => part !== "")
  const group = segments.find((segment) => ["concepts", "entities"].includes(segment.toLowerCase()))
  if (group !== undefined) {
    return [group.toLowerCase(), ...segments.slice(segments.indexOf(group) + 1)]
  }
  // Everything else folds into 其他; storage roots (wiki/, raw/) are not meaningful to readers.
  const rest = segments.filter((segment) => !["wiki", "raw"].includes(segment.toLowerCase()))
  return ["other", ...(rest.length > 0 ? rest : segments.slice(-1))]
}

function buildTree(documents: DocumentListItem[]): TreeModel {
  const nodes: TreeNode[] = []
  const folderKeys: string[] = []
  const ancestors = new Map<string, string[]>()
  const index = new Map<string, TreeNode>()
  for (const doc of documents) {
    const parts = treeSegments(doc)
    const chain: string[] = []
    let level = nodes
    let prefix = ""
    for (const part of parts.slice(0, -1)) {
      prefix = prefix === "" ? part : `${prefix}/${part}`
      let folder = index.get(prefix)
      if (folder === undefined) {
        folder = { key: `folder:${prefix}`, segment: part, children: [] }
        index.set(prefix, folder)
        folderKeys.push(folder.key)
        level.push(folder)
      }
      chain.push(folder.key)
      level = folder.children ?? (folder.children = [])
    }
    level.push({ key: `doc:${doc.id}`, segment: doc.title || doc.filename, doc })
    ancestors.set(doc.id, chain)
  }
  return { nodes, folderKeys, ancestors }
}

const TREE_RANK: Record<string, number> = { concepts: 0, entities: 1, other: 2 }

/** Folders first; 概念/实体/其他 keep their fixed order; names sort by the displayed label. */
function sortNodes(nodes: TreeNode[], lang: "zh" | "en"): TreeNode[] {
  return [...nodes].sort((a, b) => {
    const rankA = TREE_RANK[a.segment.toLowerCase()] ?? 9
    const rankB = TREE_RANK[b.segment.toLowerCase()] ?? 9
    if (rankA !== rankB) return rankA - rankB
    const folderA = a.children === undefined ? 1 : 0
    const folderB = b.children === undefined ? 1 : 0
    if (folderA !== folderB) return folderA - folderB
    const nameA = a.children === undefined ? a.segment : folderLabel(a.segment, lang)
    const nameB = b.children === undefined ? b.segment : folderLabel(b.segment, lang)
    return nameA.localeCompare(nameB, lang === "en" ? "en" : "zh-Hans-CN")
  })
}

function TreeRows({ nodes, depth, lang, isOpen, toggle, currentId }: {
  nodes: TreeNode[]
  depth: number
  lang: "zh" | "en"
  isOpen: (key: string) => boolean
  toggle: (key: string) => void
  currentId?: string | undefined
}) {
  return (
    <>
      {sortNodes(nodes, lang).map((node) => {
        if (node.children !== undefined) {
          const open = isOpen(node.key)
          return (
            <React.Fragment key={node.key}>
              <NavItem
                depth={depth}
                icon={open ? <ChevronDownIcon /> : <ChevronRightIcon />}
                onSelect={() => toggle(node.key)}
              >
                {folderLabel(node.segment, lang)}
              </NavItem>
              {open ? <TreeRows nodes={node.children} depth={depth + 1} lang={lang} isOpen={isOpen} toggle={toggle} currentId={currentId} /> : null}
            </React.Fragment>
          )
        }
        const doc = node.doc as DocumentListItem
        return (
          <NavItem
            key={node.key}
            depth={depth}
            to={`/wiki/${encodeURIComponent(doc.id)}`}
            active={doc.id === currentId}
            trailing={<StatusBadge status={pageTypeOf(doc)} />}
          >
            {doc.title || doc.filename}
          </NavItem>
        )
      })}
    </>
  )
}

function WikiPane({ documents, currentId }: { documents: DocumentListItem[]; currentId?: string | undefined }) {
  const { settings } = useApp()
  const lang: "zh" | "en" = settings?.ui_language === "en" ? "en" : "zh"
  const [query, setQuery] = React.useState("")
  // Folders are collapsed by default; only the open page's ancestors are expanded. `overrides` records
  // explicit user choices (toggle / expand-all / collapse-all) so they win over the derived default.
  const [overrides, setOverrides] = React.useState<ReadonlyMap<string, boolean>>(new Map())
  const debounced = useDebounced(query)
  const search = useQuery({
    queryKey: ["wiki-search", debounced],
    queryFn: () => searchDocuments(debounced, 20),
    enabled: debounced.trim().length > 0,
  })

  const tree = React.useMemo(() => buildTree(documents), [documents])
  const searching = debounced.trim() !== ""
  const results = React.useMemo(() => {
    if (!searching) return []
    const byId = new Map(documents.map((doc) => [doc.id, doc]))
    return (search.data?.results ?? [])
      .map((hit) => byId.get(hit.document_id))
      .filter((doc): doc is DocumentListItem => doc !== undefined)
  }, [documents, search.data, searching])

  const currentAncestors = currentId === undefined ? [] : tree.ancestors.get(currentId) ?? []
  const isOpen = (key: string) => overrides.get(key) ?? currentAncestors.includes(key)
  const toggle = (key: string) => {
    setOverrides((previous) => new Map(previous).set(key, !isOpen(key)))
  }
  const expandAll = () => setOverrides(new Map(tree.folderKeys.map((key) => [key, true])))
  const collapseAll = () => setOverrides(new Map(tree.folderKeys.map((key) => [key, false])))
  const locateCurrent = () => {
    setOverrides((previous) => {
      const next = new Map(previous)
      for (const key of currentAncestors) next.set(key, true)
      return next
    })
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      document.querySelector('ul[aria-label="Wiki 页面"] a[aria-current="page"]')?.scrollIntoView({ block: "center", behavior: "smooth" })
    }))
  }

  return (
    <Stack gap="sm">
      <Toolbar>
        <InputGroup className="min-w-0 flex-1">
          <InputGroupAddon><SearchIcon /></InputGroupAddon>
          <InputGroupInput
            aria-label="搜索页面"
            placeholder="搜索标题、路径或内容"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <InputGroupAddon align="inline-end">
            <Button size="icon-sm" variant="ghost" aria-label="定位当前页面" title="定位当前页面" onClick={locateCurrent}>
              <LocateFixedIcon />
            </Button>
          </InputGroupAddon>
        </InputGroup>
        <Button size="icon-sm" variant="ghost" aria-label="全展开" title="全展开" onClick={expandAll}><UnfoldVerticalIcon /></Button>
        <Button size="icon-sm" variant="ghost" aria-label="全折叠" title="全折叠" onClick={collapseAll}><FoldVerticalIcon /></Button>
      </Toolbar>
      {search.isError ? <ErrorState error={search.error} onRetry={() => void search.refetch()} /> : null}
      {!search.isError && (searching ? results.length === 0 : documents.length === 0) ? (
        <EmptyState
          title={searching ? "没有匹配的页面" : "工作区还没有 wiki 页面"}
          description={searching ? `没有匹配“${debounced}”的结果` : undefined}
        />
      ) : null}
      <NavList label="Wiki 页面">
        {searching ? (
          results.map((doc) => (
            <NavItem
              key={doc.id}
              to={`/wiki/${encodeURIComponent(doc.id)}`}
              active={doc.id === currentId}
              trailing={<StatusBadge status={pageTypeOf(doc)} />}
            >
              {doc.title || doc.filename}
            </NavItem>
          ))
        ) : (
          <TreeRows nodes={tree.nodes} depth={0} lang={lang} isOpen={isOpen} toggle={toggle} currentId={currentId} />
        )}
      </NavList>
    </Stack>
  )
}

function stripFrontmatter(content: string): string {
  const match = /^---[ \t]*\n[\s\S]*?\n---[ \t]*\n?/.exec(content)
  return match ? content.slice(match[0].length) : content
}

/** Drop a leading h1 that only repeats the page title already shown in the page header. */
function stripDuplicateTitle(body: string, title: string): string {
  const lines = body.split("\n")
  const index = lines.findIndex((line) => line.trim() !== "")
  const match = index < 0 ? null : /^#\s+(.+?)\s*$/.exec(lines[index] ?? "")
  if (match === null) return body
  const normalize = (value: string) => value.trim().toLowerCase().replace(/\.md$/i, "").replace(/\s+/g, " ")
  if (normalize(match[1] ?? "") !== normalize(title)) return body
  return [...lines.slice(0, index), ...lines.slice(index + 1)].join("\n")
}

/** The page header owns the only h1; demote body headings outside fenced code blocks. */
function demoteHeadings(content: string): string {
  let fence = ""
  return content.split("\n").map((line) => {
    const marker = /^\s*(```+|~~~+)/.exec(line)
    if (marker !== null) {
      const token = marker[1] ?? ""
      if (fence === "") fence = token[0] ?? "`"
      else if (token[0] === fence) fence = ""
      return line
    }
    if (fence !== "") return line
    return line.replace(/^(#{1,5})(\s+)/, (_, hashes: string, space: string) => `${hashes}#${space}`)
  }).join("\n")
}

function slugify(text: string): string {
  return text.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "")
}

type OutlineEntry = { id: string; text: string; level: number }
type ReaderDialog = "info" | "backlinks" | "forward" | "history" | "toc" | null

function Reader({ docId, documents }: { docId: string; documents: DocumentListItem[] }) {
  const queryClient = useQueryClient()
  const navigate = useAppNavigate()
  const confirm = useConfirm()
  // Keep the previous page on screen while the next one loads: the tree and header must not unmount (no flash).
  const documentQuery = useQuery({ queryKey: ["document", docId], queryFn: () => getDocument(docId), enabled: docId !== "", placeholderData: keepPreviousData })
  const doc = documentQuery.data

  const backlinks = useQuery({ queryKey: ["backlinks", docId], queryFn: () => getBacklinks(docId), enabled: docId !== "", placeholderData: keepPreviousData })
  const forward = useQuery({ queryKey: ["forward", docId], queryFn: () => getForwardReferences(docId), enabled: docId !== "", placeholderData: keepPreviousData })
  const history = useQuery({
    queryKey: ["page-history", doc?.relative_path],
    queryFn: () => listPageHistory(doc?.relative_path ?? ""),
    enabled: (doc?.relative_path ?? "") !== "",
    placeholderData: keepPreviousData,
  })

  const restore = useMutation({
    mutationFn: (revisionId: string) => restoreRevision(revisionId),
    onSuccess: async () => {
      notify.success("已恢复该版本")
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["document", docId] }),
        queryClient.invalidateQueries({ queryKey: ["page-history", doc?.relative_path] }),
        queryClient.invalidateQueries({ queryKey: ["documents", "wiki"] }),
        queryClient.invalidateQueries({ queryKey: ["history"] }),
      ])
    },
    onError: (error) => notify.error(error, "恢复失败"),
  })

  const linkIndex = React.useMemo(() => {
    const index = new Map<string, string>()
    for (const item of documents) {
      const rel = (item.relative_path ?? "").replace(/\.md$/i, "").replace(/^\/+/, "")
      if (rel) index.set(rel.toLowerCase(), item.id)
      index.set(item.filename.replace(/\.md$/i, "").toLowerCase(), item.id)
      index.set(item.filename.toLowerCase(), item.id)
    }
    return index
  }, [documents])

  const rawBody = React.useMemo(() => stripFrontmatter(doc?.content ?? ""), [doc?.content])
  const body = React.useMemo(
    () => stripDuplicateTitle(rawBody, doc?.title || doc?.filename || ""),
    [rawBody, doc?.title, doc?.filename],
  )
  const rendered = React.useMemo(() => demoteHeadings(body), [body])

  const onContentClick = React.useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const anchor = (event.target as HTMLElement).closest("a")
    if (anchor === null) return
    const href = anchor.getAttribute("href") ?? ""
    if (!href || /^(https?:|#|mailto:)/.test(href)) return
    event.preventDefault()
    const clean = href.replace(/^\/+/, "").replace(/^wiki\//, "").replace(/\.md$/i, "").toLowerCase()
    const target = linkIndex.get(clean) ?? linkIndex.get(clean.split("/").pop() ?? clean)
    if (target) navigate(`/wiki/${encodeURIComponent(target)}`)
    else notify.info(`没有找到页面：${href}`)
  }, [linkIndex, navigate])

  const [outline, setOutline] = React.useState<OutlineEntry[]>([])
  const [activeId, setActiveId] = React.useState("")
  const [dialog, setDialog] = React.useState<ReaderDialog>(null)
  const articleRef = React.useRef<HTMLDivElement>(null)
  const [measureRef, containerWidth] = useContainerWidth<HTMLDivElement>()
  // Rail needs the page width minus the list pane (18rem) to still leave a ≥900px article column.
  const narrow = containerWidth > 0 && containerWidth < 1180

  // Heading ids + outline come from the rendered DOM: code fences never produce headings, and the ids are
  // exactly what jumpTo() can find. h3/h4 are this page's section levels (h1 demoted, title h1 stripped).
  React.useEffect(() => {
    const root = articleRef.current
    if (root === null) return
    const seen = new Map<string, number>()
    const items: OutlineEntry[] = []
    for (const heading of Array.from(root.querySelectorAll("h3, h4"))) {
      const text = (heading.textContent ?? "").trim()
      if (text === "") continue
      const base = slugify(text)
      const count = (seen.get(base) ?? 0) + 1
      seen.set(base, count)
      const id = count === 1 ? base : `${base}-${count}`
      heading.id = id
      items.push({ id, text, level: heading.tagName === "H3" ? 2 : 3 })
    }
    setOutline(items)
  }, [rendered, docId, narrow])

  // Scroll spy: the current section is the last heading above the scroller's top edge; at the bottom of the
  // document the final section wins. The article lives in the only declared scroll region of the reader.
  React.useEffect(() => {
    if (outline.length === 0) return
    const scroller = articleRef.current?.closest("[data-scroll-region]")
    const root: HTMLElement | Window = scroller instanceof HTMLElement ? scroller : window
    let frame = 0
    const update = () => {
      frame = 0
      const top = (scroller instanceof HTMLElement ? scroller.getBoundingClientRect().top : 0) + 48
      let current = outline[0]?.id ?? ""
      for (const item of outline) {
        const element = document.getElementById(item.id)
        if (element !== null && element.getBoundingClientRect().top <= top) current = item.id
      }
      if (scroller instanceof HTMLElement && scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 8) {
        current = outline[outline.length - 1]?.id ?? current
      }
      setActiveId(current)
    }
    const onScroll = () => { if (frame === 0) frame = window.requestAnimationFrame(update) }
    update()
    root.addEventListener("scroll", onScroll, { passive: true })
    return () => {
      root.removeEventListener("scroll", onScroll)
      if (frame !== 0) window.cancelAnimationFrame(frame)
    }
  }, [outline])

  const jumpTo = (id: string) => {
    setActiveId(id)
    setDialog(null)
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" })
  }

  if (documentQuery.isLoading) return <RowsSkeleton rows={8} />
  if (documentQuery.isError) return <ErrorState error={documentQuery.error} onRetry={() => void documentQuery.refetch()} />
  if (!doc) return <EmptyState title="页面不存在" description="链接可能已失效，或该内容已被删除。" />

  const tocEntries = outline.map((item) => (
    <NavItem key={item.id} indent={item.level === 3} active={activeId === item.id} onSelect={() => jumpTo(item.id)}>
      {item.text}
    </NavItem>
  ))

  const content = (
    <Body width="full" align="start">
      <div ref={articleRef} onClick={onContentClick}>
        <Markdown>{rendered || "_（空页面）_"}</Markdown>
      </div>
    </Body>
  )

  const infoDialog = (
    <Dialog open={dialog === "info"} onOpenChange={(open) => { if (!open) setDialog(null) }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>页面信息</DialogTitle>
          <DialogDescription>{doc.title || doc.filename}</DialogDescription>
        </DialogHeader>
        <Panel padding="none">
          <Rows label="页面信息">
            {[
              { label: "类型", value: <StatusBadge status={pageTypeOf(doc)} /> },
              { label: "路径", value: doc.relative_path },
              { label: "更新", value: <Time value={doc.updated_at} mode="datetime" /> },
              { label: "版本", value: `${doc.version}` },
              { label: "反链", value: `${backlinks.data?.length ?? 0} 条` },
              { label: "引用", value: `${forward.data?.length ?? 0} 条` },
            ].map((item) => (
              <Row key={item.label}>
                <span className="shrink-0 text-xs text-muted-foreground">{item.label}</span>
                <span className="min-w-0 flex-1 break-words text-sm">{item.value}</span>
              </Row>
            ))}
          </Rows>
        </Panel>
      </DialogContent>
    </Dialog>
  )

  const backlinksDialog = (
    <Dialog open={dialog === "backlinks"} onOpenChange={(open) => { if (!open) setDialog(null) }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>反向引用</DialogTitle>
          <DialogDescription>引用当前页面的其他页面。</DialogDescription>
        </DialogHeader>
        {(backlinks.data?.length ?? 0) === 0 ? <EmptyState title="暂无反向引用" /> : (
          <Panel padding="none">
            <Rows label="反向引用">
              {backlinks.data?.map((ref) => (
                <Row key={`${ref.path}-${ref.filename}-${ref.reference_type}`}>
                  <span className="min-w-0 flex-1 truncate">{ref.title || ref.filename}</span>
                  <StatusBadge status={ref.reference_type} />
                </Row>
              ))}
            </Rows>
          </Panel>
        )}
      </DialogContent>
    </Dialog>
  )

  const forwardDialog = (
    <Dialog open={dialog === "forward"} onOpenChange={(open) => { if (!open) setDialog(null) }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>前向引用</DialogTitle>
          <DialogDescription>当前页面引用到的其他页面。</DialogDescription>
        </DialogHeader>
        {(forward.data?.length ?? 0) === 0 ? <EmptyState title="暂无引用" /> : (
          <Panel padding="none">
            <Rows label="前向引用">
              {forward.data?.map((ref) => (
                <Row key={`${ref.path}-${ref.filename}-${ref.reference_type}`}>
                  <span className="min-w-0 flex-1 truncate">{ref.title || ref.filename}</span>
                  <StatusBadge status={ref.reference_type} />
                  {ref.page > 0 ? <span className="text-xs text-muted-foreground">p.{ref.page}</span> : null}
                </Row>
              ))}
            </Rows>
          </Panel>
        )}
      </DialogContent>
    </Dialog>
  )

  const historyDialog = (
    <Dialog open={dialog === "history"} onOpenChange={(open) => { if (!open) setDialog(null) }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>页面历史</DialogTitle>
          <DialogDescription>每次写入生成一个不可变版本。</DialogDescription>
        </DialogHeader>
        {history.isLoading ? <RowsSkeleton rows={3} /> : null}
        {history.isError ? <ErrorState error={history.error} onRetry={() => void history.refetch()} /> : null}
        {!history.isLoading && !history.isError && (history.data?.revisions?.length ?? 0) === 0 ? <EmptyState title="暂无历史版本" /> : null}
        {(history.data?.revisions?.length ?? 0) > 0 ? (
          <Panel padding="none">
            <Rows label="页面历史">
              {history.data?.revisions?.map((revision) => (
                <Row key={revision.id}>
                  <span className="text-xs text-muted-foreground">#{revision.revision_no}</span>
                  <StatusBadge status={revision.operation} />
                  <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{revision.actor}</span>
                  <Time value={revision.created_at} mode="datetime" />
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={async () => {
                      const ok = await confirm({
                        title: `恢复版本 #${revision.revision_no}？`,
                        description: "将以该版本内容创建一个新的变更集，不会删除现有历史。",
                        confirmLabel: "恢复",
                      })
                      if (ok) restore.mutate(revision.id)
                    }}
                  >
                    <RotateCcwIcon />恢复
                  </Button>
                </Row>
              ))}
            </Rows>
          </Panel>
        ) : null}
      </DialogContent>
    </Dialog>
  )

  const tocDialog = (
    <Dialog open={dialog === "toc"} onOpenChange={(open) => { if (!open) setDialog(null) }}>
      <DialogContent>
        <DialogHeader><DialogTitle>目录</DialogTitle></DialogHeader>
        <NavList label="目录">{tocEntries}</NavList>
      </DialogContent>
    </Dialog>
  )

  const tocAction = narrow && outline.length > 0
    ? [{ label: "目录", icon: <ListTreeIcon />, iconOnly: true, onSelect: () => setDialog("toc") }]
    : []

  return (
    <Page
      title={doc.title || doc.filename}
      layout="fill"
      breadcrumbs={[{ label: "Wiki", to: "/wiki" }]}
      inlineMax={5}
      actions={[
        ...tocAction,
        { label: "反向引用", icon: <Link2Icon />, iconOnly: true, onSelect: () => setDialog("backlinks") },
        { label: "前向引用", icon: <ExternalLinkIcon />, iconOnly: true, onSelect: () => setDialog("forward") },
        { label: "页面历史", icon: <HistoryIcon />, iconOnly: true, onSelect: () => setDialog("history") },
        { label: "页面信息", icon: <InfoIcon />, iconOnly: true, onSelect: () => setDialog("info") },
      ]}
    >
      <div ref={measureRef} className="flex min-h-0 min-w-0 flex-1 flex-col">
        <Split
          sideLabel="Wiki 页面"
          sideWidth="lg"
          collapseBelow={900}
          side={<WikiPane documents={documents} currentId={docId} />}
        >
          {!narrow && outline.length > 0 ? (
            <Split
              sideLabel="目录"
              sideWidth="md"
              sidePosition="end"
              collapseBelow={720}
              side={
                <Stack gap="xs">
                  <span className="text-xs font-medium text-muted-foreground">目录</span>
                  <NavList label="目录">{tocEntries}</NavList>
                </Stack>
              }
            >
              {content}
            </Split>
          ) : content}
        </Split>
      </div>
      {infoDialog}
      {backlinksDialog}
      {forwardDialog}
      {historyDialog}
      {tocDialog}
    </Page>
  )
}

export function WikiReaderPage() {
  const { id } = useParams()
  const navigate = useAppNavigate()
  const documentsQuery = useQuery({
    queryKey: ["documents", "wiki"],
    queryFn: () => listDocuments({ exclude_hidden: true }),
  })
  const documents = React.useMemo(() => documentsQuery.data ?? [], [documentsQuery.data])

  React.useEffect(() => {
    if (id === undefined && documents.length > 0) {
      navigate(`/wiki/${encodeURIComponent(documents[0]?.id ?? "")}`, { replace: true })
    }
  }, [documents, id, navigate])

  if (documentsQuery.isLoading) return <RowsSkeleton rows={8} />
  if (documentsQuery.isError) return <ErrorState error={documentsQuery.error} onRetry={() => void documentsQuery.refetch()} />

  if (id === undefined) {
    return (
      <Page title="Wiki" layout="fill">
        <Body width="full" align="start">
          <EmptyState title="选择一个页面" description="从左侧列表选择，或搜索标题与内容。" />
        </Body>
      </Page>
    )
  }
  return <Reader docId={id} documents={documents} />
}
