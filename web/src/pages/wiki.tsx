import * as React from "react"
import { useParams } from "react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { HashIcon, HistoryIcon, RotateCcwIcon, SearchIcon } from "lucide-react"
import { Markdown } from "@/components/blocks/markdown"
import { AppLink, useAppNavigate } from "@/components/blocks/router"
import { ListDetailLayout, ListPaneTrigger, PaneHeader, PaneSection } from "@/components/blocks/list-detail"
import { Body, NavItem, NavList, Page, Panel, Row, Rows, ScrollRegion, Section, Split, Stack } from "@/components/blocks/surfaces"
import { StatusBadge } from "@/components/blocks/status-badge"
import { EmptyState, ErrorState, RowsSkeleton } from "@/components/blocks/state-boundary"
import { Time } from "@/components/blocks/format"
import { useConfirm } from "@/components/blocks/confirm"
import { notify } from "@/components/blocks/notify"
import { Button } from "@/components/ui/button"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
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

const PAGE_TYPE_LABELS: Record<string, string> = {
  entity: "实体",
  concept: "概念",
  source: "来源",
  synthesis: "综合",
  comparison: "对比",
  query: "问题",
  page: "页面",
}

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

function WikiPane({ documents }: { documents: DocumentListItem[] }) {
  const [query, setQuery] = React.useState("")
  const [type, setType] = React.useState("all")
  const debounced = useDebounced(query)
  const search = useQuery({
    queryKey: ["wiki-search", debounced],
    queryFn: () => searchDocuments(debounced, 20),
    enabled: debounced.trim().length > 0,
  })

  const visible = React.useMemo(() => {
    if (debounced.trim() && search.data) {
      const byId = new Map(documents.map((doc) => [doc.id, doc]))
      return search.data.results
        .map((hit) => byId.get(hit.document_id))
        .filter((doc): doc is DocumentListItem => doc !== undefined)
    }
    return type === "all" ? documents : documents.filter((doc) => pageTypeOf(doc) === type)
  }, [debounced, documents, search.data, type])

  return (
    <>
      <PaneHeader>
        <span className="min-w-0 flex-1 truncate text-sm font-medium">Wiki 页面</span>
        <span className="text-xs text-muted-foreground">{documents.length}</span>
      </PaneHeader>
      <PaneSection>
        <InputGroup>
          <InputGroupAddon><SearchIcon /></InputGroupAddon>
          <InputGroupInput
            aria-label="搜索页面"
            placeholder="搜索标题、路径或内容"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </InputGroup>
        <Select value={type} onValueChange={setType}>
          <SelectTrigger size="sm" aria-label="按页面类型筛选"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部类型</SelectItem>
            {Object.entries(PAGE_TYPE_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </PaneSection>
      <PaneSection grow>
        <Panel padding="none">
          {search.isError ? <ErrorState error={search.error} onRetry={() => void search.refetch()} /> : null}
          {!search.isError && visible.length === 0 ? (
            <EmptyState title="没有匹配的页面" description={debounced ? `没有匹配“${debounced}”的结果` : "工作区还没有 wiki 页面"} />
          ) : null}
          <Rows label="Wiki 页面">
            {visible.map((doc) => (
              <Row key={doc.id}>
                <div className="min-w-0 flex-1">
                  <AppLink to={`/wiki/${encodeURIComponent(doc.id)}`} className="block truncate text-sm hover:text-brand">
                    {doc.title || doc.filename}
                  </AppLink>
                  <div className="truncate text-xs text-muted-foreground">{doc.relative_path}</div>
                </div>
                <StatusBadge status={pageTypeOf(doc)} />
              </Row>
            ))}
          </Rows>
        </Panel>
      </PaneSection>
    </>
  )
}

function stripFrontmatter(content: string): string {
  const match = /^---[ \t]*\n[\s\S]*?\n---[ \t]*\n?/.exec(content)
  return match ? content.slice(match[0].length) : content
}

function outlineOf(content: string): { level: number; text: string }[] {
  return content
    .split("\n")
    .map((line) => /^(#{1,4})\s+(.+?)\s*$/.exec(line))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => ({ level: (match[1] ?? "").length, text: match[2] ?? "" }))
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

function Reader({ docId, documents }: { docId: string; documents: DocumentListItem[] }) {
  const queryClient = useQueryClient()
  const navigate = useAppNavigate()
  const confirm = useConfirm()
  const documentQuery = useQuery({ queryKey: ["document", docId], queryFn: () => getDocument(docId), enabled: docId !== "" })
  const doc = documentQuery.data

  const backlinks = useQuery({ queryKey: ["backlinks", docId], queryFn: () => getBacklinks(docId), enabled: docId !== "" })
  const forward = useQuery({ queryKey: ["forward", docId], queryFn: () => getForwardReferences(docId), enabled: docId !== "" })
  const history = useQuery({
    queryKey: ["page-history", doc?.relative_path],
    queryFn: () => listPageHistory(doc?.relative_path ?? ""),
    enabled: (doc?.relative_path ?? "") !== "",
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

  const body = React.useMemo(() => stripFrontmatter(doc?.content ?? ""), [doc?.content])
  const outline = React.useMemo(() => outlineOf(body), [body])
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

  if (documentQuery.isLoading) return <RowsSkeleton rows={8} />
  if (documentQuery.isError) return <ErrorState error={documentQuery.error} onRetry={() => void documentQuery.refetch()} />
  if (!doc) return <EmptyState title="页面不存在" description="链接可能已失效，或该内容已被删除。" />

  const infoPanel = (
    <Panel title="页面信息" padding="none">
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
  )

  const outlinePanel = outline.length > 0 ? (
    <Stack gap="xs">
      <span className="text-xs font-medium text-muted-foreground">目录</span>
      <NavList label="目录">
        {outline.map((item, index) => (
          <NavItem key={`${item.text}-${index}`} icon={<HashIcon />} indent={item.level > 2}>
            {item.text}
          </NavItem>
        ))}
      </NavList>
    </Stack>
  ) : null

  const article = (
    <Panel>
      <div onClick={onContentClick}>
        <Markdown>{rendered || "_（空页面）_"}</Markdown>
      </div>
    </Panel>
  )

  const references = (
    <>
      <Section title="反向引用" description="引用当前页面的其他页面。">
        <Panel padding="none">
          {(backlinks.data?.length ?? 0) === 0 ? <EmptyState title="暂无反向引用" /> : (
            <Rows label="反向引用">
              {backlinks.data?.map((ref) => (
                <Row key={`${ref.path}-${ref.filename}-${ref.reference_type}`}>
                  <span className="min-w-0 flex-1 truncate">{ref.title || ref.filename}</span>
                  <StatusBadge status={ref.reference_type} />
                </Row>
              ))}
            </Rows>
          )}
        </Panel>
      </Section>

      <Section title="前向引用" description="当前页面引用到的其他页面。">
        <Panel padding="none">
          {(forward.data?.length ?? 0) === 0 ? <EmptyState title="暂无引用" /> : (
            <Rows label="前向引用">
              {forward.data?.map((ref) => (
                <Row key={`${ref.path}-${ref.filename}-${ref.reference_type}`}>
                  <span className="min-w-0 flex-1 truncate">{ref.title || ref.filename}</span>
                  <StatusBadge status={ref.reference_type} />
                  {ref.page > 0 ? <span className="text-xs text-muted-foreground">p.{ref.page}</span> : null}
                </Row>
              ))}
            </Rows>
          )}
        </Panel>
      </Section>

      <Section
        title="页面历史"
        description="每次写入生成一个不可变版本。"
        actions={<HistoryIcon aria-hidden className="text-muted-foreground" />}
      >
        <Panel padding="none">
          {history.isLoading ? <RowsSkeleton rows={3} /> : null}
          {history.isError ? <ErrorState error={history.error} onRetry={() => void history.refetch()} /> : null}
          {(history.data?.revisions.length ?? 0) === 0 && !history.isLoading ? <EmptyState title="暂无历史版本" /> : null}
          <Rows label="页面历史">
            {history.data?.revisions.map((revision) => (
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
      </Section>
    </>
  )

  return (
    <Page
      title={doc.title || doc.filename}
      layout="fill"
      leading={<ListPaneTrigger />}
      breadcrumbs={[{ label: "Wiki", to: "/wiki" }]}
    >
      <Split
        sideLabel="页面信息"
        sideWidth="lg"
        side={infoPanel}
      >
        <ScrollRegion>
          <Body width="reading">
            {article}
            {outlinePanel}
            {references}
          </Body>
        </ScrollRegion>
      </Split>
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

  return (
    <ListDetailLayout label="Wiki 页面" pane={<WikiPane documents={documents} />}>
      {id === undefined ? <EmptyState title="选择一个页面" description="从左侧列表选择，或搜索标题与内容。" /> : <Reader docId={id} documents={documents} />}
    </ListDetailLayout>
  )
}
