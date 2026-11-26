import * as React from "react"
import { useParams } from "react-router"
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  ExternalLinkIcon,
  FilePlusIcon,
  FoldVerticalIcon,
  FolderInputIcon,
  FolderPenIcon,
  FolderPlusIcon,
  HistoryIcon,
  InfoIcon,
  Link2Icon,
  ListTreeIcon,
  LocateFixedIcon,
  MoreHorizontalIcon,
  PencilIcon,
  RotateCcwIcon,
  SearchIcon,
  Trash2Icon,
  UnfoldVerticalIcon,
} from "lucide-react"
import { Markdown } from "@/components/blocks/markdown"
import { ReferencesBlock } from "@/components/blocks/references-block"
import { useAppNavigate } from "@/components/blocks/router"
import { Actions, Body, Inline, NavItem, NavList, Page, Panel, Row, Rows, Split, Stack, Toolbar } from "@/components/blocks/surfaces"
import { StatusBadge } from "@/components/blocks/status-badge"
import { EmptyState, ErrorState, RowsSkeleton } from "@/components/blocks/state-boundary"
import { Time } from "@/components/blocks/format"
import { useConfirm } from "@/components/blocks/confirm"
import { notify } from "@/components/blocks/notify"
import { useContainerWidth } from "@/components/blocks/use-container-width"
import { useApp } from "@/context/app-context"
import { Button } from "@/components/ui/button"
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "@/components/ui/context-menu"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import {
  deleteDocument,
  getBacklinks,
  getDocument,
  getForwardReferences,
  getWikiTree,
  listDocuments,
  listPageHistory,
  moveDocument,
  moveFolder,
  restoreRevision,
  searchDocuments,
  updateDocumentMetadata,
} from "@/lib/api"
import { WikiFileIcon, WikiFolderIcon, WikiPageTypeIcon } from "@/lib/file-icons"
import { WikiTreeDialogs, type TreeDialogState } from "@/pages/wiki-tree-dialogs"
import type { DocumentListItem, WikiFolder } from "@/types"

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
  return ({ entities: "entity", concepts: "concept", experiences: "experience", ledgers: "ledger", sources: "source", synthesis: "synthesis", comparisons: "comparison", queries: "query" } as Record<string, string>)[subdir] ?? "page"
}

type TreeNode = {
  key: string
  segment: string
  folderPath?: string
  folder?: WikiFolder
  doc?: DocumentListItem
  children?: TreeNode[]
}
type TreeModel = { nodes: TreeNode[]; folderKeys: string[]; ancestors: Map<string, string[]> }
type DragPayload = { kind: "doc"; id: string; folder: string } | { kind: "folder"; path: string }

const TREE_OVERRIDES_KEY = "llmwiki:wiki:tree-overrides"

const FOLDER_LABELS: Record<string, { zh: string; en: string }> = {
  concepts: { zh: "概念", en: "Concepts" },
  entities: { zh: "实体", en: "Entities" },
  experiences: { zh: "经验", en: "Experiences" },
  ledgers: { zh: "台账", en: "Ledgers" },
  sources: { zh: "来源", en: "Sources" },
  synthesis: { zh: "综合", en: "Synthesis" },
  comparisons: { zh: "对比", en: "Comparisons" },
  queries: { zh: "问题", en: "Queries" },
  sessions: { zh: "会话", en: "Sessions" },
  "web-ingest": { zh: "网页抓取", en: "Web ingest" },
  archive: { zh: "归档", en: "Archive" },
}

function folderLabel(segment: string, lang: "zh" | "en", folder?: WikiFolder): string {
  if (folder?.display_name) return folder.display_name
  const entry = FOLDER_LABELS[segment.toLowerCase()]
  return entry === undefined ? segment : lang === "en" ? entry.en : entry.zh
}

function folderPathOfDoc(doc: { relative_path?: string | undefined; path?: string | undefined }): string {
  const raw = (doc.relative_path ?? doc.path ?? "").replace(/^\/+/, "").replace(/^wiki\//, "")
  const idx = raw.lastIndexOf("/")
  return idx >= 0 ? raw.slice(0, idx) : ""
}

/**
 * Pages maintained by `llmwiki reindex`; mirrors RESERVED_TOP_LEVEL_WIKI_PAGES in
 * src/engine/wiki_org.ts. The API rejects moving/archiving/deleting them.
 */
const SYSTEM_PAGE_PATHS = new Set(["wiki/index.md", "wiki/log.md", "wiki/overview.md"])

function isSystemPage(doc: { relative_path?: string | undefined; path?: string | undefined }): boolean {
  return SYSTEM_PAGE_PATHS.has((doc.relative_path ?? doc.path ?? "").replace(/^\/+/, ""))
}

/** Total pages under a subtree, including nested folders and the currently filtered/archived view. */
function countTreeDocs(nodes: TreeNode[]): number {
  let count = 0
  for (const node of nodes) {
    if (node.doc !== undefined) count += 1
    if (node.children !== undefined) count += countTreeDocs(node.children)
  }
  return count
}

function buildTree(folders: WikiFolder[], documents: DocumentListItem[], typeFilter: string): TreeModel {
  const folderByPath = new Map(folders.map((f) => [f.path, f]))
  const nodes: TreeNode[] = []
  const folderKeys: string[] = []
  const ancestors = new Map<string, string[]>()
  const index = new Map<string, TreeNode>()

  const ensureFolderChain = (folderPath: string): { level: TreeNode[]; chain: string[] } => {
    if (!folderPath) return { level: nodes, chain: [] }
    const parts = folderPath.split("/").filter(Boolean)
    const chain: string[] = []
    let level = nodes
    let prefix = ""
    for (const part of parts) {
      prefix = prefix === "" ? part : `${prefix}/${part}`
      let folderNode = index.get(prefix)
      if (folderNode === undefined) {
        const meta = folderByPath.get(prefix)
        folderNode = {
          key: `folder:${prefix}`,
          segment: part,
          folderPath: prefix,
          ...(meta ? { folder: meta } : {}),
          children: [],
        }
        index.set(prefix, folderNode)
        folderKeys.push(folderNode.key)
        level.push(folderNode)
      }
      chain.push(folderNode.key)
      level = folderNode.children ?? (folderNode.children = [])
    }
    return { level, chain }
  }

  // Only show empty folders when no type filter is active
  if (typeFilter === "all") {
    for (const folder of folders) {
      ensureFolderChain(folder.path)
    }
  }

  for (const doc of documents) {
    if (typeFilter !== "all" && pageTypeOf(doc) !== typeFilter) continue
    const folderPath = folderPathOfDoc(doc)
    const { level, chain } = ensureFolderChain(folderPath)
    level.push({ key: `doc:${doc.id}`, segment: doc.title || doc.filename, doc })
    ancestors.set(doc.id, chain)
  }

  return { nodes, folderKeys, ancestors }
}

/** System pages first (stable), then folders (by sort_order then label), then documents. */
function sortNodes(nodes: TreeNode[], lang: "zh" | "en"): TreeNode[] {
  return [...nodes].sort((a, b) => {
    const systemA = a.doc !== undefined && isSystemPage(a.doc) ? 0 : 1
    const systemB = b.doc !== undefined && isSystemPage(b.doc) ? 0 : 1
    if (systemA !== systemB) return systemA - systemB
    const folderA = a.children === undefined ? 1 : 0
    const folderB = b.children === undefined ? 1 : 0
    if (folderA !== folderB) return folderA - folderB
    if (folderA === 0) {
      const sa = a.folder?.sort_order ?? 0
      const sb = b.folder?.sort_order ?? 0
      if (sa !== sb) return sa - sb
    }
    const nameA = a.children === undefined ? a.segment : folderLabel(a.segment, lang, a.folder)
    const nameB = b.children === undefined ? b.segment : folderLabel(b.segment, lang, b.folder)
    return nameA.localeCompare(nameB, lang === "en" ? "en" : "zh-Hans-CN")
  })
}

function TreeRows({
  nodes,
  depth,
  lang,
  isOpen,
  toggle,
  currentId,
  dragOverKey,
  setDragOverKey,
  onDropOnFolder,
  onOpenDialog,
  onDeleteDoc,
}: {
  nodes: TreeNode[]
  depth: number
  lang: "zh" | "en"
  isOpen: (key: string) => boolean
  toggle: (key: string) => void
  currentId?: string | undefined
  dragOverKey: string | null
  setDragOverKey: (key: string | null) => void
  onDropOnFolder: (targetFolder: string, payload: DragPayload) => void
  onOpenDialog: (dialog: TreeDialogState) => void
  onDeleteDoc: (doc: DocumentListItem) => void
}) {
  const clampedDepth = Math.min(3, depth)
  const sorted = sortNodes(nodes, lang)
  const systemCount = depth === 0
    ? sorted.filter((node) => node.doc !== undefined && isSystemPage(node.doc)).length
    : 0
  return (
    <>
      {systemCount > 0 ? (
        <li role="presentation" className="text-xs font-medium tracking-wide text-muted-foreground">
          系统
        </li>
      ) : null}
      {sorted.map((node, index) => {
        if (node.children !== undefined && node.folderPath !== undefined) {
          const folderPath = node.folderPath
          const folderObj: WikiFolder = node.folder ?? {
            path: folderPath,
            display_name: "",
            description: "",
            sort_order: 0,
            created_at: "",
            updated_at: "",
            direct_count: 0,
            total_count: 0,
          }
          const open = isOpen(node.key)
          const label = folderLabel(node.segment, lang, node.folder)
          const count = countTreeDocs(node.children ?? [])
          const isDropTarget = dragOverKey === node.key
          const menuItems = (
            <>
              <DropdownMenuItem onSelect={() => onOpenDialog({ kind: "create-folder", parentPath: folderPath })}>
                <FolderPlusIcon />新建子目录
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onOpenDialog({ kind: "create-page", folderPath })}>
                <FilePlusIcon />在此新建页面
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => onOpenDialog({ kind: "edit-folder", folder: folderObj })}>
                <PencilIcon />编辑目录
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onOpenDialog({ kind: "move-folder", folder: folderObj })}>
                <FolderPenIcon />移动 / 重命名
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => onOpenDialog({ kind: "delete-folder", folder: folderObj })}>
                <Trash2Icon />删除目录
              </DropdownMenuItem>
            </>
          )
          const ctxItems = (
            <>
              <ContextMenuItem onSelect={() => onOpenDialog({ kind: "create-folder", parentPath: folderPath })}>
                <FolderPlusIcon />新建子目录
              </ContextMenuItem>
              <ContextMenuItem onSelect={() => onOpenDialog({ kind: "create-page", folderPath })}>
                <FilePlusIcon />在此新建页面
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem onSelect={() => onOpenDialog({ kind: "edit-folder", folder: folderObj })}>
                <PencilIcon />编辑目录
              </ContextMenuItem>
              <ContextMenuItem onSelect={() => onOpenDialog({ kind: "move-folder", folder: folderObj })}>
                <FolderPenIcon />移动 / 重命名
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem variant="destructive" onSelect={() => onOpenDialog({ kind: "delete-folder", folder: folderObj })}>
                <Trash2Icon />删除目录
              </ContextMenuItem>
            </>
          )
          return (
            <React.Fragment key={node.key}>
              <ContextMenu>
                <ContextMenuTrigger asChild>
                  <div
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData("application/x-llmwiki-tree", JSON.stringify({ kind: "folder", path: folderPath } satisfies DragPayload))
                      e.dataTransfer.effectAllowed = "move"
                    }}
                    onDragOver={(e) => {
                      e.preventDefault()
                      if (dragOverKey !== node.key) setDragOverKey(node.key)
                    }}
                    onDragLeave={() => {
                      if (dragOverKey === node.key) setDragOverKey(null)
                    }}
                    onDrop={(e) => {
                      e.preventDefault()
                      setDragOverKey(null)
                      const raw = e.dataTransfer.getData("application/x-llmwiki-tree")
                      if (!raw) return
                      try {
                        onDropOnFolder(folderPath, JSON.parse(raw) as DragPayload)
                      } catch {
                        // ignore invalid drag payload
                      }
                    }}
                    className={isDropTarget ? "wiki-tree-row bg-accent/50" : "wiki-tree-row"}
                  >
                    <NavItem
                      depth={clampedDepth}
                      icon={<WikiFolderIcon open={open} />}
                      onSelect={() => toggle(node.key)}
                      trailing={
                        <Inline gap="xs">
                          <span className="text-xs tabular-nums text-muted-foreground">{count}</span>
                          <span className="wiki-tree-row-actions">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  size="icon-xs"
                                  variant="ghost"
                                  aria-label={`操作目录 ${label}`}
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <MoreHorizontalIcon />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" onClick={(event) => event.stopPropagation()}>{menuItems}</DropdownMenuContent>
                            </DropdownMenu>
                          </span>
                        </Inline>
                      }
                    >
                      <span className="wiki-tree-folder-label">{label}</span>
                    </NavItem>
                  </div>
                </ContextMenuTrigger>
                <ContextMenuContent onClick={(event) => event.stopPropagation()}>{ctxItems}</ContextMenuContent>
              </ContextMenu>
              {open ? (
                <TreeRows
                  nodes={node.children}
                  depth={depth + 1}
                  lang={lang}
                  isOpen={isOpen}
                  toggle={toggle}
                  currentId={currentId}
                  dragOverKey={dragOverKey}
                  setDragOverKey={setDragOverKey}
                  onDropOnFolder={onDropOnFolder}
                  onOpenDialog={onOpenDialog}
                  onDeleteDoc={onDeleteDoc}
                />
              ) : null}
            </React.Fragment>
          )
        }
        const doc = node.doc as DocumentListItem
        const system = isSystemPage(doc)
        const lastSystem = depth === 0 && systemCount > 0 && index === systemCount - 1
        return (
          <React.Fragment key={node.key}>
            <ContextMenu>
              <ContextMenuTrigger asChild>
                <div
                  draggable={!system}
                  className={doc.archived_at ? "wiki-tree-row is-archived" : "wiki-tree-row"}
                  onDragStart={(e) => {
                    if (system) {
                      e.preventDefault()
                      return
                    }
                    e.dataTransfer.setData(
                      "application/x-llmwiki-tree",
                      JSON.stringify({ kind: "doc", id: doc.id, folder: folderPathOfDoc(doc) } satisfies DragPayload),
                    )
                    e.dataTransfer.effectAllowed = "move"
                  }}
                >
                  <NavItem
                    depth={clampedDepth}
                    to={`/wiki/${encodeURIComponent(doc.id)}`}
                    active={doc.id === currentId}
                    icon={<WikiFileIcon doc={doc} treeAligned />}
                    trailing={
                      <Inline gap="xs">
                        {system ? <StatusBadge status="system" /> : null}
                        {doc.archived_at ? <StatusBadge status="archived" /> : null}
                        {system ? null : (
                          <span className="wiki-tree-row-actions">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  size="icon-xs"
                                  variant="ghost"
                                  aria-label={`操作页面 ${doc.title || doc.filename}`}
                                  onClick={(e) => {
                                    e.preventDefault()
                                    e.stopPropagation()
                                  }}
                                >
                                  <MoreHorizontalIcon />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" onClick={(event) => event.stopPropagation()}>
                                <DropdownMenuItem onSelect={() => onOpenDialog({ kind: "move-doc", doc })}>
                                  <FolderInputIcon />移动 / 重命名
                                </DropdownMenuItem>
                                {doc.archived_at ? (
                                  <DropdownMenuItem onSelect={() => onOpenDialog({ kind: "reopen-doc", doc })}>
                                    <ArchiveRestoreIcon />重新启用
                                  </DropdownMenuItem>
                                ) : (
                                  <DropdownMenuItem onSelect={() => onOpenDialog({ kind: "archive-doc", doc })}>
                                    <ArchiveIcon />归档页面
                                  </DropdownMenuItem>
                                )}
                                <DropdownMenuSeparator />
                                <DropdownMenuItem variant="destructive" onSelect={() => onDeleteDoc(doc)}>
                                  <Trash2Icon />删除页面
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </span>
                        )}
                      </Inline>
                    }
                  >
                    {doc.title || doc.filename}
                  </NavItem>
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent onClick={(event) => event.stopPropagation()}>
                {system ? (
                  <ContextMenuItem disabled>系统页面由 reindex 自动维护</ContextMenuItem>
                ) : (
                  <>
                    <ContextMenuItem onSelect={() => onOpenDialog({ kind: "move-doc", doc })}>
                      <FolderInputIcon />移动 / 重命名
                    </ContextMenuItem>
                    {doc.archived_at ? (
                      <ContextMenuItem onSelect={() => onOpenDialog({ kind: "reopen-doc", doc })}>
                        <ArchiveRestoreIcon />重新启用
                      </ContextMenuItem>
                    ) : (
                      <ContextMenuItem onSelect={() => onOpenDialog({ kind: "archive-doc", doc })}>
                        <ArchiveIcon />归档页面
                      </ContextMenuItem>
                    )}
                    <ContextMenuSeparator />
                    <ContextMenuItem variant="destructive" onSelect={() => onDeleteDoc(doc)}>
                      <Trash2Icon />删除页面
                    </ContextMenuItem>
                  </>
                )}
              </ContextMenuContent>
            </ContextMenu>
            {lastSystem ? (
              <li role="presentation" aria-hidden>
                <Separator />
              </li>
            ) : null}
          </React.Fragment>
        )
      })}
    </>
  )
}

function useWikiPane({
  folders,
  documents,
  currentId,
  showArchived = false,
  onShowArchivedChange,
}: {
  folders: WikiFolder[]
  documents: DocumentListItem[]
  currentId?: string | undefined
  showArchived?: boolean | undefined
  onShowArchivedChange?: ((v: boolean) => void) | undefined
}) {
  const { settings } = useApp()
  const navigate = useAppNavigate()
  const confirm = useConfirm()
  const queryClient = useQueryClient()
  const lang: "zh" | "en" = settings?.ui_language === "en" ? "en" : "zh"
  const [query, setQuery] = React.useState("")
  const [typeFilter, setTypeFilter] = React.useState("all")
  const [dialogState, setDialogState] = React.useState<TreeDialogState>(null)
  const [dragOverKey, setDragOverKey] = React.useState<string | null>(null)
  // Folders are collapsed by default; only the open page's ancestors are expanded. `overrides` records
  // explicit user choices (toggle / expand-all / collapse-all) so they win over the derived default.
  const [overrides, setOverrides] = React.useState<ReadonlyMap<string, boolean>>(() => {
    try {
      const raw = window.localStorage.getItem(TREE_OVERRIDES_KEY)
      if (raw === null) return new Map()
      const parsed: unknown = JSON.parse(raw)
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return new Map()
      return new Map(Object.entries(parsed).filter((entry): entry is [string, boolean] => typeof entry[1] === "boolean"))
    } catch {
      return new Map()
    }
  })
  React.useEffect(() => {
    window.localStorage.setItem(TREE_OVERRIDES_KEY, JSON.stringify(Object.fromEntries(overrides)))
  }, [overrides])
  const debounced = useDebounced(query)
  const search = useQuery({
    queryKey: ["wiki-search", debounced, typeFilter, showArchived],
    queryFn: () =>
      searchDocuments(debounced, 20, typeFilter === "all" ? undefined : [typeFilter], undefined, {
        archived: showArchived ? "include" : "exclude",
      }),
    enabled: debounced.trim().length > 0,
  })

  const tree = React.useMemo(() => buildTree(folders, documents, typeFilter), [folders, documents, typeFilter])
  const searching = debounced.trim() !== ""
  const results = React.useMemo(() => {
    if (!searching) return []
    const byId = new Map(documents.map((doc) => [doc.id, doc]))
    return (search.data?.results ?? [])
      .map((hit) => byId.get(hit.document_id))
      .filter((doc): doc is DocumentListItem => doc !== undefined)
  }, [documents, search.data, searching])

  const invalidateTree = React.useCallback(async (docId?: string) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["wiki-tree"] }),
      queryClient.invalidateQueries({ queryKey: ["wiki-link-documents"] }),
      queryClient.invalidateQueries({ queryKey: ["documents", "wiki"] }),
      queryClient.invalidateQueries({ queryKey: ["workspace"] }),
      ...(docId ? [queryClient.invalidateQueries({ queryKey: ["document", docId] })] : []),
    ])
  }, [queryClient])

  const moveDocMut = useMutation({
    mutationFn: ({ id, targetFolder }: { id: string; targetFolder: string }) =>
      moveDocument(id, { target_folder: targetFolder }),
    onSuccess: async (_res, vars) => {
      notify.success("已移动页面")
      await invalidateTree(vars.id)
    },
    onError: (err) => notify.error(err, "移动页面失败"),
  })

  const moveFolderMut = useMutation({
    mutationFn: ({ fromPath, toPath }: { fromPath: string; toPath: string }) =>
      moveFolder({ from_path: fromPath, to_path: toPath }),
    onSuccess: async () => {
      notify.success("已移动目录")
      await invalidateTree()
    },
    onError: (err) => notify.error(err, "移动目录失败"),
  })

  const deleteDocMut = useMutation({
    mutationFn: (id: string) => deleteDocument(id),
    onSuccess: async (_res, id) => {
      notify.success("页面已删除")
      await invalidateTree(id)
      if (id === currentId) navigate("/wiki")
    },
    onError: (err) => notify.error(err, "删除页面失败"),
  })

  const handleDropOnFolder = (targetFolder: string, payload: DragPayload) => {
    if (payload.kind === "doc") {
      if (payload.folder === targetFolder) return
      moveDocMut.mutate({ id: payload.id, targetFolder })
      return
    }
    const seg = payload.path.includes("/") ? payload.path.slice(payload.path.lastIndexOf("/") + 1) : payload.path
    const toPath = targetFolder ? `${targetFolder}/${seg}` : seg
    if (toPath === payload.path || toPath.startsWith(`${payload.path}/`)) return
    moveFolderMut.mutate({ fromPath: payload.path, toPath })
  }

  const handleDeleteDoc = async (doc: DocumentListItem) => {
    const ok = await confirm({
      title: `删除页面“${doc.title || doc.filename}”？`,
      description: "页面将移入归档，可在历史中恢复。",
      confirmLabel: "删除",
      destructive: true,
    })
    if (ok) deleteDocMut.mutate(doc.id)
  }

  const currentAncestors = currentId === undefined ? [] : tree.ancestors.get(currentId) ?? []
  const isOpen = (key: string) => overrides.get(key) ?? currentAncestors.includes(key)
  const toggle = (key: string) => {
    setOverrides((previous) => new Map(previous).set(key, !isOpen(key)))
  }
  const expandAll = () => setOverrides(new Map(tree.folderKeys.map((key) => [key, true])))
  const collapseAll = () => setOverrides(new Map(tree.folderKeys.map((key) => [key, false])))
  const allOpen = tree.folderKeys.length > 0 && tree.folderKeys.every((key) => isOpen(key))
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

  const sideHeader = (
    <Stack gap="sm">
      <InputGroup>
        <InputGroupAddon><SearchIcon /></InputGroupAddon>
        <InputGroupInput
          aria-label="搜索页面"
          placeholder="搜索标题、路径或内容"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </InputGroup>
      <Toolbar
        end={
          <>
            {onShowArchivedChange ? (
              <Button
                size="icon-sm"
                variant={showArchived ? "secondary" : "ghost"}
                aria-label={showArchived ? "隐藏已归档页面" : "显示已归档页面"}
                aria-pressed={showArchived}
                title={showArchived ? "隐藏已归档页面" : "显示已归档页面"}
                onClick={() => onShowArchivedChange(!showArchived)}
              >
                <ArchiveIcon />
              </Button>
            ) : null}
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="新建目录"
              title="新建目录"
              onClick={() => setDialogState({ kind: "create-folder", parentPath: "" })}
            >
              <FolderPlusIcon />
            </Button>
            {searching ? null : (
              <>
                <Button size="icon-sm" variant="ghost" aria-label="定位当前页面" title="定位当前页面" onClick={locateCurrent}>
                  <LocateFixedIcon />
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={allOpen ? "全部折叠" : "全部展开"}
                  title={allOpen ? "全部折叠" : "全部展开"}
                  onClick={allOpen ? collapseAll : expandAll}
                >
                  {allOpen ? <FoldVerticalIcon /> : <UnfoldVerticalIcon />}
                </Button>
              </>
            )}
          </>
        }
      >
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger aria-label="按页面类型筛选" className="w-28 shrink-0">
            <SelectValue placeholder="全部类型" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部类型</SelectItem>
            <SelectItem value="concept"><span className="llmwiki-select-option"><WikiPageTypeIcon pageType="concept" />概念</span></SelectItem>
            <SelectItem value="entity"><span className="llmwiki-select-option"><WikiPageTypeIcon pageType="entity" />实体</span></SelectItem>
            <SelectItem value="experience"><span className="llmwiki-select-option"><WikiPageTypeIcon pageType="experience" />经验</span></SelectItem>
            <SelectItem value="ledger"><span className="llmwiki-select-option"><WikiPageTypeIcon pageType="ledger" />台账</span></SelectItem>
            <SelectItem value="synthesis"><span className="llmwiki-select-option"><WikiPageTypeIcon pageType="synthesis" />综合</span></SelectItem>
            <SelectItem value="comparison"><span className="llmwiki-select-option"><WikiPageTypeIcon pageType="comparison" />对比</span></SelectItem>
            <SelectItem value="query"><span className="llmwiki-select-option"><WikiPageTypeIcon pageType="query" />问题</span></SelectItem>
            <SelectItem value="page"><span className="llmwiki-select-option"><WikiPageTypeIcon pageType="page" />普通页面</span></SelectItem>
          </SelectContent>
        </Select>
      </Toolbar>
    </Stack>
  )

  const side = (
    <Stack gap="sm">
      {search.isError ? <ErrorState error={search.error} onRetry={() => void search.refetch()} /> : null}
      {!search.isError && (searching ? results.length === 0 : tree.nodes.length === 0) ? (
        <EmptyState
          title={searching ? "没有匹配的页面" : "工作区还没有 wiki 页面"}
          description={searching ? `没有匹配“${debounced}”的结果` : undefined}
        />
      ) : null}
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          const raw = e.dataTransfer.getData("application/x-llmwiki-tree")
          if (!raw) return
          try {
            const payload = JSON.parse(raw) as DragPayload
            if (payload.kind === "doc" && payload.folder !== "") {
              e.preventDefault()
              setDragOverKey(null)
              handleDropOnFolder("", payload)
            } else if (payload.kind === "folder" && payload.path.includes("/")) {
              e.preventDefault()
              setDragOverKey(null)
              handleDropOnFolder("", payload)
            }
          } catch {
            // ignore
          }
        }}
      >
        <NavList label="Wiki 页面">
          {searching ? (
            results.map((doc) => (
              <NavItem
                key={doc.id}
                to={`/wiki/${encodeURIComponent(doc.id)}`}
                active={doc.id === currentId}
                icon={<WikiFileIcon doc={doc} />}
                trailing={<StatusBadge status={pageTypeOf(doc)} />}
              >
                {doc.title || doc.filename}
              </NavItem>
            ))
          ) : (
            <TreeRows
              nodes={tree.nodes}
              depth={0}
              lang={lang}
              isOpen={isOpen}
              toggle={toggle}
              currentId={currentId}
              dragOverKey={dragOverKey}
              setDragOverKey={setDragOverKey}
              onDropOnFolder={handleDropOnFolder}
              onOpenDialog={setDialogState}
              onDeleteDoc={handleDeleteDoc}
            />
          )}
        </NavList>
      </div>
      <WikiTreeDialogs
        state={dialogState}
        folders={folders}
        onClose={() => setDialogState(null)}
        onCreatedDoc={(id) => navigate(`/wiki/${encodeURIComponent(id)}`)}
      />
    </Stack>
  )

  return { sideHeader, side }
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

/** Turn inline [[target]] / [[target|label]] wiki links into markdown links;
 * onContentClick resolves them through linkIndex exactly like relative page
 * links. Fenced code blocks are left untouched. */
function linkifyWikilinks(content: string): string {
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
    return line.replace(/\[\[([^\]|#]+?)(?:\\?\|([^\]]*))?\]\]/g, (_match, target: string, label?: string) => {
      const clean = target.trim()
      const label2 = (label ?? "").trim() || clean
      // Spaces break markdown link URLs; encode for href, keep the label readable.
      return `[${label2}](${clean.replace(/ /g, "%20")})`
    })
  }).join("\n")
}

function slugify(text: string): string {
  return text.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "")
}

type OutlineEntry = { id: string; text: string; level: number }
type ReaderDialog = "info" | "backlinks" | "forward" | "history" | "toc" | null

function Reader({
  docId,
  folders,
  documents,
  showArchived = false,
  onShowArchivedChange,
}: {
  docId: string
  folders: WikiFolder[]
  documents: DocumentListItem[]
  showArchived?: boolean | undefined
  onShowArchivedChange?: ((v: boolean) => void) | undefined
}) {
  const queryClient = useQueryClient()
  const navigate = useAppNavigate()
  const confirm = useConfirm()
  const { settings } = useApp()
  const lang: "zh" | "en" = settings?.ui_language === "en" ? "en" : "zh"
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

  const updateTypeMut = useMutation({
    mutationFn: (pageType: string) => updateDocumentMetadata(docId, { page_type: pageType }),
    onSuccess: async () => {
      notify.success("已更新页面类型")
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["document", docId] }),
        queryClient.invalidateQueries({ queryKey: ["wiki-tree"] }),
        queryClient.invalidateQueries({ queryKey: ["documents", "wiki"] }),
      ])
    },
    onError: (err) => notify.error(err, "更新页面类型失败"),
  })

  const [moveDialog, setMoveDialog] = React.useState<TreeDialogState>(null)

  const breadcrumbs = React.useMemo(() => {
    const items: { label: string; to: string }[] = [{ label: "Wiki", to: "/wiki" }]
    if (!doc) return items
    const folderPath = folderPathOfDoc(doc)
    if (!folderPath) return items
    const folderMap = new Map(folders.map((f) => [f.path, f]))
    const parts = folderPath.split("/").filter(Boolean)
    let prefix = ""
    for (const part of parts) {
      prefix = prefix === "" ? part : `${prefix}/${part}`
      items.push({ label: folderLabel(part, lang, folderMap.get(prefix)), to: "/wiki" })
    }
    return items
  }, [doc, folders, lang])

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

  // `documents` comes from the visible tree, which omits hidden subdirs (sources/templates).
  // Auto-generated pages still link to `sources/...`, so resolve inline wiki links against the
  // complete wiki document list; otherwise the content index renders dead links.
  const linkDocs = useQuery({
    queryKey: ["wiki-link-documents"],
    queryFn: () => listDocuments({ source_kind: "wiki", archived: "include" }),
    staleTime: 60_000,
  })
  const linkIndex = React.useMemo(() => {
    const index = new Map<string, string>()
    for (const item of [...documents, ...(linkDocs.data ?? [])]) {
      const rel = (item.relative_path ?? "").replace(/\.md$/i, "").replace(/^\/+/, "")
      if (rel) index.set(rel.toLowerCase(), item.id)
      index.set(item.filename.replace(/\.md$/i, "").toLowerCase(), item.id)
      index.set(item.filename.toLowerCase(), item.id)
    }
    return index
  }, [documents, linkDocs.data])

  const rawBody = React.useMemo(() => stripFrontmatter(doc?.content ?? ""), [doc?.content])
  const body = React.useMemo(
    () => stripDuplicateTitle(rawBody, doc?.title || doc?.filename || ""),
    [rawBody, doc?.title, doc?.filename],
  )
  const rendered = React.useMemo(() => linkifyWikilinks(demoteHeadings(body)), [body])

  const onContentClick = React.useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const anchor = (event.target as HTMLElement).closest("a")
    if (anchor === null) return
    const href = anchor.getAttribute("href") ?? ""
    if (!href || /^(https?:|#|mailto:)/.test(href)) return
    event.preventDefault()
    let raw = href
    try {
      raw = decodeURIComponent(href)
    } catch {
      // keep the original when it is not valid percent-encoding
    }
    const clean = raw.replace(/^\/+/, "").replace(/^wiki\//, "").replace(/\.md$/i, "").toLowerCase()
    // [[Adam Foroughi]] vs filename Adam_Foroughi.md — retry with underscores.
    const target =
      linkIndex.get(clean) ??
      linkIndex.get(clean.replace(/ /g, "_")) ??
      linkIndex.get(clean.split("/").pop() ?? clean)
    if (target) navigate(`/wiki/${encodeURIComponent(target)}`)
    else notify.info(`没有找到页面：${href}`)
  }, [linkIndex, navigate])

  const [outline, setOutline] = React.useState<OutlineEntry[]>([])
  const [activeId, setActiveId] = React.useState("")
  const [dialog, setDialog] = React.useState<ReaderDialog>(null)
  // The outline rail can be hidden; the choice persists across visits.
  const [tocHidden, setTocHidden] = React.useState(() => window.localStorage.getItem("llmwiki:wiki:toc-hidden") === "1")
  const toggleToc = () => {
    setTocHidden((previous) => {
      const next = !previous
      window.localStorage.setItem("llmwiki:wiki:toc-hidden", next ? "1" : "0")
      return next
    })
  }
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

  const wikiPane = useWikiPane({
    folders,
    documents,
    currentId: docId,
    showArchived,
    onShowArchivedChange,
  })

  if (documentQuery.isLoading) return <RowsSkeleton rows={8} />
  if (documentQuery.isError) return <ErrorState error={documentQuery.error} onRetry={() => void documentQuery.refetch()} />
  if (!doc) return <EmptyState title="页面不存在" description="链接可能已失效，或该内容已被删除。" />

  const tocEntries = outline.map((item) => (
    <NavItem key={item.id} indent={item.level === 3} active={activeId === item.id} onSelect={() => jumpTo(item.id)}>
      {item.text}
    </NavItem>
  ))

  const todayIso = new Date().toISOString().slice(0, 10)
  const isOverdue = Boolean(doc?.review_after && !doc?.archived_at && doc.review_after < todayIso)

  const content = (
    <Body width="full" align="start">
      <Stack gap="md">
        {doc?.archived_at ? (
          <Panel padding="md">
            <Actions align="between">
              <Stack gap="xs">
                <Actions align="start">
                  <StatusBadge status="archived" />
                  <span className="text-sm font-medium">此页面已于 {doc.archived_at} 归档</span>
                </Actions>
                {doc.archive_reason ? (
                  <span className="text-xs text-muted-foreground">原因：{doc.archive_reason}</span>
                ) : null}
                {doc.superseded_by ? (
                  <span className="text-xs text-muted-foreground">替代页面：{doc.superseded_by}</span>
                ) : null}
              </Stack>
              <Button size="sm" variant="outline" onClick={() => setMoveDialog({ kind: "reopen-doc", doc })}>
                <ArchiveRestoreIcon />重新启用
              </Button>
            </Actions>
          </Panel>
        ) : null}
        {isOverdue ? (
          <Panel padding="md">
            <Actions align="start">
              <StatusBadge status="overdue" />
              <span className="text-xs text-muted-foreground">计划复审日期 {doc?.review_after} 已到期，建议核实内容后更新 `last_verified`。</span>
            </Actions>
          </Panel>
        ) : null}
        <div ref={articleRef} onClick={onContentClick}>
          <Markdown>{rendered || "_（空页面）_"}</Markdown>
          <ReferencesBlock
            entries={doc.reference_entries ?? []}
            archiveSources={doc.archive_sources ?? []}
            lang={lang}
            onOpen={(id) => navigate(`/wiki/${encodeURIComponent(id)}`)}
            onOpenArchive={(archiveId) => navigate(`/archives/${encodeURIComponent(archiveId)}`)}
          />
        </div>
      </Stack>
    </Body>
  )

  const infoDialog = (
    <Dialog open={dialog === "info"} onOpenChange={(open) => { if (!open) setDialog(null) }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>页面信息</DialogTitle>
          <DialogDescription>{doc.title || doc.filename}</DialogDescription>
        </DialogHeader>
        <Panel padding="none">
          <Rows label="页面信息">
            {[
              {
                label: "类型",
                value: (
                  <Select value={pageTypeOf(doc)} onValueChange={(v) => updateTypeMut.mutate(v)}>
                    <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="concept">concept</SelectItem>
                      <SelectItem value="entity">entity</SelectItem>
                      <SelectItem value="experience">experience</SelectItem>
                      <SelectItem value="ledger">ledger</SelectItem>
                      <SelectItem value="synthesis">synthesis</SelectItem>
                      <SelectItem value="comparison">comparison</SelectItem>
                      <SelectItem value="query">query</SelectItem>
                      <SelectItem value="page">page</SelectItem>
                    </SelectContent>
                  </Select>
                ),
              },
              ...(doc.confidence ? [{ label: "置信度", value: <StatusBadge status={doc.confidence} /> }] : []),
              ...(doc.page_status ? [{ label: "状态", value: <StatusBadge status={doc.page_status} /> }] : []),
              ...(doc.experience_kind ? [{ label: "经验子类", value: <StatusBadge status={doc.experience_kind} /> }] : []),
              ...(doc.last_verified ? [{ label: "最近核实", value: doc.last_verified }] : []),
              ...(doc.review_after ? [{ label: "复审日期", value: doc.review_after }] : []),
              ...(doc.aliases && doc.aliases.length > 0 ? [{ label: "别名", value: doc.aliases.join("、") }] : []),
              ...(doc.symptoms && doc.symptoms.length > 0 ? [{ label: "现象", value: doc.symptoms.join("、") }] : []),
              ...(doc.archived_at ? [{ label: "归档时间", value: doc.archived_at }] : []),
              { label: "路径", value: doc.relative_path },
              { label: "更新", value: <Time value={doc.updated_at} mode="datetime" /> },
              { label: "版本", value: `${doc.version}` },
              { label: "反链", value: `${backlinks.data?.length ?? 0} 条` },
              { label: "引用", value: `${forward.data?.length ?? 0} 条` },
              ...(doc.archive_sources && doc.archive_sources.length > 0
                ? [
                    {
                      label: "关联源文件",
                      value: (
                        <Stack gap="xs">
                          {doc.archive_sources.map((src) => (
                            <button
                              key={src.id}
                              type="button"
                              onClick={() => {
                                setDialog(null)
                                navigate(`/archives/${encodeURIComponent(src.id)}`)
                              }}
                              className="text-left text-sm text-primary hover:underline"
                            >
                              {src.relative_path}
                            </button>
                          ))}
                        </Stack>
                      ),
                    },
                  ]
                : []),
            ].map((item) => (
              <Row key={item.label}>
                <span className="shrink-0 text-xs text-muted-foreground">{item.label}</span>
                <span className="min-w-0 flex-1 break-words text-sm">{item.value}</span>
              </Row>
            ))}
          </Rows>
        </Panel>
        <Actions align="between">
          <Button
            variant="outline"
            onClick={() => {
              setDialog(null)
              setMoveDialog({ kind: "move-doc", doc })
            }}
          >
            <FolderInputIcon />移动到其他目录…
          </Button>
          {doc.archived_at ? (
            <Button
              variant="outline"
              onClick={() => {
                setDialog(null)
                setMoveDialog({ kind: "reopen-doc", doc })
              }}
            >
              <ArchiveRestoreIcon />重新启用
            </Button>
          ) : (
            <Button
              variant="outline"
              onClick={() => {
                setDialog(null)
                setMoveDialog({ kind: "archive-doc", doc })
              }}
            >
              <ArchiveIcon />归档页面…
            </Button>
          )}
        </Actions>
      </DialogContent>
    </Dialog>
  )

  const backlinksDialog = (
    <Dialog open={dialog === "backlinks"} onOpenChange={(open) => { if (!open) setDialog(null) }}>
      <DialogContent className="sm:max-w-lg">
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
      <DialogContent className="sm:max-w-lg">
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
      <DialogContent className="sm:max-w-lg">
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

  const tocAction = outline.length === 0
    ? []
    : [narrow
        ? { label: "目录", icon: <ListTreeIcon />, iconOnly: true, onSelect: () => setDialog("toc") }
        : { label: tocHidden ? "显示目录" : "隐藏目录", icon: <ListTreeIcon />, iconOnly: true, onSelect: toggleToc }]

  return (
    <Page
      title={doc.title || doc.filename}
      layout="fill"
      breadcrumbs={breadcrumbs}
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
          sideHeader={wikiPane.sideHeader}
          side={wikiPane.side}
        >
          {!narrow && !tocHidden && outline.length > 0 ? (
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
      <WikiTreeDialogs
        state={moveDialog}
        folders={folders}
        onClose={() => setMoveDialog(null)}
        onCreatedDoc={(newId) => navigate(`/wiki/${encodeURIComponent(newId)}`)}
      />
    </Page>
  )
}

export function WikiReaderPage() {
  const { id } = useParams()
  const navigate = useAppNavigate()
  const [showArchived, setShowArchived] = React.useState(
    () => window.localStorage.getItem("llmwiki:wiki:show-archived") === "1",
  )
  React.useEffect(() => {
    window.localStorage.setItem("llmwiki:wiki:show-archived", showArchived ? "1" : "0")
  }, [showArchived])
  const treeQuery = useQuery({
    queryKey: ["wiki-tree", showArchived],
    queryFn: () => getWikiTree({ exclude_hidden: true, archived: showArchived ? "include" : "exclude" }),
  })
  const folders = React.useMemo(() => treeQuery.data?.folders ?? [], [treeQuery.data])
  const documents = React.useMemo(() => treeQuery.data?.documents ?? [], [treeQuery.data])

  const emptyWikiPane = useWikiPane({
    folders,
    documents,
    showArchived,
    onShowArchivedChange: setShowArchived,
  })

  React.useEffect(() => {
    if (id === undefined && documents.length > 0) {
      navigate(`/wiki/${encodeURIComponent(documents[0]?.id ?? "")}`, { replace: true })
    }
  }, [documents, id, navigate])

  if (treeQuery.isLoading) return <RowsSkeleton rows={8} />
  if (treeQuery.isError) return <ErrorState error={treeQuery.error} onRetry={() => void treeQuery.refetch()} />

  if (id === undefined) {
    return (
      <Page title="Wiki" layout="fill">
        <Split
          sideLabel="Wiki 页面"
          sideWidth="lg"
          collapseBelow={900}
          sideHeader={emptyWikiPane.sideHeader}
          side={emptyWikiPane.side}
        >
          <Body width="full" align="start">
            <EmptyState title="选择一个页面" description="从左侧目录树选择或新建目录/页面，或搜索标题与内容。" />
          </Body>
        </Split>
      </Page>
    )
  }
  return (
    <Reader
      docId={id}
      folders={folders}
      documents={documents}
      showArchived={showArchived}
      onShowArchivedChange={setShowArchived}
    />
  )
}
