import * as React from "react"
import { useParams } from "react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  CodeIcon,
  DownloadIcon,
  ExternalLinkIcon,
  FoldVerticalIcon,
  FolderIcon,
  FolderInputIcon,
  FolderPlusIcon,
  InfoIcon,
  LocateFixedIcon,
  MoreHorizontalIcon,
  PencilIcon,
  SaveIcon,
  SearchIcon,
  Trash2Icon,
  UnfoldVerticalIcon,
  UploadIcon,
  XIcon,
} from "lucide-react"
import { useConfirm } from "@/components/blocks/confirm"
import { Time } from "@/components/blocks/format"
import { Markdown } from "@/components/blocks/markdown"
import { notify } from "@/components/blocks/notify"
import { useAppNavigate } from "@/components/blocks/router"
import { EmptyState, ErrorState, RowsSkeleton } from "@/components/blocks/state-boundary"
import { Actions, Body, Inline, NavItem, NavList, Page, Panel, Row, Rows, Split, Stack, Toolbar } from "@/components/blocks/surfaces"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "@/components/ui/context-menu"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import {
  archiveFileRawUrl,
  deleteArchiveFile,
  getArchiveFile,
  getArchiveFileText,
  getArchiveTree,
  moveArchiveFolder,
  updateArchiveFileContent,
  updateArchiveFileLocation,
  uploadArchiveFiles,
} from "@/lib/api"
import { WikiFileIcon, WikiFolderIcon } from "@/lib/file-icons"
import { ArchiveTreeDialogs, type ArchiveDialogState } from "@/pages/archive-dialogs"
import type { ArchiveFile, ArchiveFolder } from "@/types"

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function backendLabel(backend: ArchiveFile["storage_backend"]): string {
  if (backend === "db") return "数据库"
  if (backend === "s3") return "S3 对象存储"
  return "本地目录"
}

const ARCHIVE_TREE_OVERRIDES_KEY = "llmwiki:archive:tree-overrides"

const ARCHIVE_KIND_OPTIONS: { value: string; label: string; filename: string }[] = [
  { value: "markdown", label: "Markdown", filename: "file.md" },
  { value: "html", label: "HTML", filename: "file.html" },
  { value: "image", label: "图片", filename: "file.png" },
  { value: "video", label: "视频", filename: "file.mp4" },
  { value: "audio", label: "音频", filename: "file.mp3" },
  { value: "pdf", label: "PDF", filename: "file.pdf" },
  { value: "text", label: "文本/代码", filename: "file.txt" },
  { value: "other", label: "其他", filename: "file.bin" },
]

type ArchiveDragPayload = { kind: "file"; id: string; folder: string } | { kind: "folder"; path: string }

type TreeNode = {
  key: string
  segment: string
  folderPath?: string | undefined
  folder?: ArchiveFolder | undefined
  file?: ArchiveFile | undefined
  children?: TreeNode[] | undefined
}

function countTreeFiles(nodes: TreeNode[]): number {
  let count = 0
  for (const node of nodes) {
    if (node.file !== undefined) count += 1
    if (node.children !== undefined) count += countTreeFiles(node.children)
  }
  return count
}

function buildArchiveTree(folders: ArchiveFolder[], files: ArchiveFile[], showEmptyFolders: boolean) {
  const folderMap = new Map<string, ArchiveFolder>()
  for (const folder of folders) folderMap.set(folder.path, folder)

  const nodes: TreeNode[] = []
  const folderKeys: string[] = []
  const index = new Map<string, TreeNode>()

  const ensureFolderChain = (folderPath: string): TreeNode[] => {
    if (!folderPath) return nodes
    const parts = folderPath.split("/").filter(Boolean)
    let level = nodes
    let prefix = ""
    for (const part of parts) {
      prefix = prefix === "" ? part : `${prefix}/${part}`
      let folderNode = index.get(prefix)
      if (folderNode === undefined) {
        const meta = folderMap.get(prefix)
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
      level = folderNode.children ?? (folderNode.children = [])
    }
    return level
  }

  if (showEmptyFolders) {
    for (const folder of folders) ensureFolderChain(folder.path)
  }
  for (const file of files) {
    const level = ensureFolderChain(file.folder_path)
    level.push({ key: `file:${file.id}`, segment: file.filename, file })
  }
  return { nodes, folderKeys }
}

function sortArchiveNodes(nodes: TreeNode[]): TreeNode[] {
  return [...nodes].sort((a, b) => {
    const folderA = a.children === undefined ? 1 : 0
    const folderB = b.children === undefined ? 1 : 0
    if (folderA !== folderB) return folderA - folderB
    if (folderA === 0) {
      const sa = a.folder?.sort_order ?? 0
      const sb = b.folder?.sort_order ?? 0
      if (sa !== sb) return sa - sb
    }
    const nameA = a.children === undefined ? a.segment : (a.folder?.display_name || a.segment)
    const nameB = b.children === undefined ? b.segment : (b.folder?.display_name || b.segment)
    return nameA.localeCompare(nameB, "zh-Hans-CN")
  })
}

function ArchiveTreeRows({
  nodes,
  depth,
  isOpen,
  toggle,
  currentId,
  dragOverKey,
  setDragOverKey,
  onDropOnFolder,
  onUpload,
  onOpenDialog,
  onTriggerUpload,
  onDeleteFile,
}: {
  nodes: TreeNode[]
  depth: number
  isOpen: (key: string) => boolean
  toggle: (key: string) => void
  currentId?: string | undefined
  dragOverKey: string | null
  setDragOverKey: (key: string | null) => void
  onDropOnFolder: (targetFolder: string, payload: ArchiveDragPayload) => void
  onUpload: (folderPath: string, picked: File[]) => void
  onOpenDialog: (state: ArchiveDialogState) => void
  onTriggerUpload: (folderPath: string) => void
  onDeleteFile: (file: ArchiveFile) => void
}) {
  const clampedDepth = Math.min(3, depth)
  const sorted = sortArchiveNodes(nodes)
  return (
    <>
      {sorted.map((node) => {
        if (node.children !== undefined && node.folderPath !== undefined) {
          const folderPath = node.folderPath
          const open = isOpen(node.key)
          const label = node.folder?.display_name || node.segment
          const count = countTreeFiles(node.children ?? [])
          const isDropTarget = dragOverKey === node.key
          const menuItems = (
            <>
              <DropdownMenuItem onSelect={() => onTriggerUpload(folderPath)}>
                <UploadIcon />上传到此目录
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onOpenDialog({ kind: "new-folder", parentPath: folderPath })}>
                <FolderPlusIcon />新建子目录
              </DropdownMenuItem>
              {node.folder ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => onOpenDialog({ kind: "rename-folder", folder: node.folder! })}>
                    <PencilIcon />重命名显示名
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => onOpenDialog({ kind: "move-folder", folder: node.folder! })}>
                    <FolderIcon />移动目录路径
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onSelect={() => onOpenDialog({ kind: "delete-folder", folder: node.folder! })}>
                    <Trash2Icon />删除目录
                  </DropdownMenuItem>
                </>
              ) : null}
            </>
          )
          const ctxItems = (
            <>
              <ContextMenuItem onSelect={() => onTriggerUpload(folderPath)}>
                <UploadIcon />上传到此目录
              </ContextMenuItem>
              <ContextMenuItem onSelect={() => onOpenDialog({ kind: "new-folder", parentPath: folderPath })}>
                <FolderPlusIcon />新建子目录
              </ContextMenuItem>
              {node.folder ? (
                <>
                  <ContextMenuSeparator />
                  <ContextMenuItem onSelect={() => onOpenDialog({ kind: "rename-folder", folder: node.folder! })}>
                    <PencilIcon />重命名显示名
                  </ContextMenuItem>
                  <ContextMenuItem onSelect={() => onOpenDialog({ kind: "move-folder", folder: node.folder! })}>
                    <FolderIcon />移动目录路径
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem variant="destructive" onSelect={() => onOpenDialog({ kind: "delete-folder", folder: node.folder! })}>
                    <Trash2Icon />删除目录
                  </ContextMenuItem>
                </>
              ) : null}
            </>
          )
          return (
            <React.Fragment key={node.key}>
              <ContextMenu>
                <ContextMenuTrigger asChild>
                  <div
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData("application/x-llmwiki-archive", JSON.stringify({ kind: "folder", path: folderPath } satisfies ArchiveDragPayload))
                      e.dataTransfer.effectAllowed = "move"
                    }}
                    onDragOver={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      if (dragOverKey !== node.key) setDragOverKey(node.key)
                    }}
                    onDragLeave={() => {
                      if (dragOverKey === node.key) setDragOverKey(null)
                    }}
                    onDrop={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      setDragOverKey(null)
                      if (e.dataTransfer.files.length > 0) {
                        onUpload(folderPath, [...e.dataTransfer.files])
                        return
                      }
                      const raw = e.dataTransfer.getData("application/x-llmwiki-archive")
                      if (!raw) return
                      try {
                        onDropOnFolder(folderPath, JSON.parse(raw) as ArchiveDragPayload)
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
                <ArchiveTreeRows
                  nodes={node.children}
                  depth={depth + 1}
                  isOpen={isOpen}
                  toggle={toggle}
                  currentId={currentId}
                  dragOverKey={dragOverKey}
                  setDragOverKey={setDragOverKey}
                  onDropOnFolder={onDropOnFolder}
                  onUpload={onUpload}
                  onOpenDialog={onOpenDialog}
                  onTriggerUpload={onTriggerUpload}
                  onDeleteFile={onDeleteFile}
                />
              ) : null}
            </React.Fragment>
          )
        }

        const file = node.file as ArchiveFile
        return (
          <React.Fragment key={node.key}>
            <ContextMenu>
              <ContextMenuTrigger asChild>
                <div
                  draggable
                  className="wiki-tree-row"
                  onDragStart={(e) => {
                    e.dataTransfer.setData(
                      "application/x-llmwiki-archive",
                      JSON.stringify({ kind: "file", id: file.id, folder: file.folder_path } satisfies ArchiveDragPayload),
                    )
                    e.dataTransfer.effectAllowed = "move"
                  }}
                >
                  <NavItem
                    depth={clampedDepth}
                    to={`/archives/${encodeURIComponent(file.id)}`}
                    active={file.id === currentId}
                    icon={<WikiFileIcon doc={file} treeAligned />}
                    trailing={
                      <Inline gap="xs">
                        <span className="text-xs tabular-nums text-muted-foreground">{formatBytes(file.size)}</span>
                        <span className="wiki-tree-row-actions">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                size="icon-xs"
                                variant="ghost"
                                aria-label={`操作文件 ${file.filename}`}
                                onClick={(e) => {
                                  e.preventDefault()
                                  e.stopPropagation()
                                }}
                              >
                                <MoreHorizontalIcon />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" onClick={(event) => event.stopPropagation()}>
                              <DropdownMenuItem onSelect={() => onOpenDialog({ kind: "move-file", file })}>
                                <FolderInputIcon />移动 / 重命名
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem variant="destructive" onSelect={() => onDeleteFile(file)}>
                                <Trash2Icon />删除文件
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </span>
                      </Inline>
                    }
                  >
                    {file.filename}
                  </NavItem>
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent onClick={(event) => event.stopPropagation()}>
                <ContextMenuItem onSelect={() => onOpenDialog({ kind: "move-file", file })}>
                  <FolderInputIcon />移动 / 重命名
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem variant="destructive" onSelect={() => onDeleteFile(file)}>
                  <Trash2Icon />删除文件
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          </React.Fragment>
        )
      })}
    </>
  )
}

function useArchivePane({
  folders,
  files,
  currentId,
  kindFilter,
  onKindFilterChange,
  query,
  onQueryChange,
  onTriggerUpload,
  onOpenDialog,
}: {
  folders: ArchiveFolder[]
  files: ArchiveFile[]
  currentId?: string | undefined
  kindFilter: string
  onKindFilterChange: (v: string) => void
  query: string
  onQueryChange: (v: string) => void
  onTriggerUpload: (folderPath: string) => void
  onOpenDialog: (state: ArchiveDialogState) => void
}) {
  const navigate = useAppNavigate()
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const [dragOverKey, setDragOverKey] = React.useState<string | null>(null)
  const [overrides, setOverrides] = React.useState<ReadonlyMap<string, boolean>>(() => {
    try {
      const raw = window.localStorage.getItem(ARCHIVE_TREE_OVERRIDES_KEY)
      if (raw === null) return new Map()
      const parsed: unknown = JSON.parse(raw)
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return new Map()
      return new Map(Object.entries(parsed).filter((entry): entry is [string, boolean] => typeof entry[1] === "boolean"))
    } catch {
      return new Map()
    }
  })
  React.useEffect(() => {
    window.localStorage.setItem(ARCHIVE_TREE_OVERRIDES_KEY, JSON.stringify(Object.fromEntries(overrides)))
  }, [overrides])

  const searching = query.trim() !== ""
  const filteredFiles = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    return files.filter((file) => {
      if (kindFilter !== "all" && file.kind !== kindFilter) return false
      if (q && !file.relative_path.toLowerCase().includes(q) && !file.filename.toLowerCase().includes(q)) return false
      return true
    })
  }, [files, kindFilter, query])

  const tree = React.useMemo(
    () => buildArchiveTree(folders, searching ? [] : filteredFiles, kindFilter === "all" && !searching),
    [folders, filteredFiles, kindFilter, searching],
  )

  const currentAncestors = React.useMemo(() => {
    if (currentId === undefined) return []
    const current = files.find((file) => file.id === currentId)
    if (!current?.folder_path) return []
    const parts = current.folder_path.split("/").filter(Boolean)
    const keys: string[] = []
    let prefix = ""
    for (const part of parts) {
      prefix = prefix === "" ? part : `${prefix}/${part}`
      keys.push(`folder:${prefix}`)
    }
    return keys
  }, [currentId, files])

  const moveDropFileMut = useMutation({
    mutationFn: ({ id, folder }: { id: string; folder: string }) =>
      updateArchiveFileLocation(id, { folder_path: folder }),
    onSuccess: async () => {
      notify.success("已移动文件")
      await queryClient.invalidateQueries({ queryKey: ["archive-tree"] })
    },
    onError: (err: Error) => notify.error(err, "移动文件失败"),
  })

  const moveDropFolderMut = useMutation({
    mutationFn: ({ from, to }: { from: string; to: string }) => moveArchiveFolder(from, to),
    onSuccess: async () => {
      notify.success("已移动目录")
      await queryClient.invalidateQueries({ queryKey: ["archive-tree"] })
    },
    onError: (err: Error) => notify.error(err, "移动目录失败"),
  })

  const deleteFileMut = useMutation({
    mutationFn: (id: string) => deleteArchiveFile(id),
    onSuccess: async (_res, id) => {
      notify.success("文件已删除")
      await queryClient.invalidateQueries({ queryKey: ["archive-tree"] })
      if (id === currentId) navigate("/archives", { replace: true })
    },
    onError: (err: Error) => notify.error(err, "删除文件失败"),
  })

  const handleDeleteFile = async (file: ArchiveFile) => {
    const ok = await confirm({
      title: `删除档案文件「${file.filename}」？`,
      description: "删除后将同时清理对应存储实体，不可撤销。",
      confirmLabel: "删除",
      destructive: true,
    })
    if (ok) deleteFileMut.mutate(file.id)
  }

  const handleUpload = async (folderPath: string, picked: File[]) => {
    if (picked.length === 0) return
    try {
      await uploadArchiveFiles(picked, folderPath)
      notify.success(folderPath ? `已上传到 ${folderPath}` : "已上传")
      await queryClient.invalidateQueries({ queryKey: ["archive-tree"] })
    } catch (err) {
      notify.error(err, "上传失败")
    }
  }

  const handleDropOnFolder = (targetFolder: string, payload: ArchiveDragPayload) => {
    if (payload.kind === "file") {
      if (payload.folder === targetFolder) return
      moveDropFileMut.mutate({ id: payload.id, folder: targetFolder })
      return
    }
    if (payload.path === targetFolder || targetFolder.startsWith(`${payload.path}/`)) return
    const seg = payload.path.includes("/") ? payload.path.slice(payload.path.lastIndexOf("/") + 1) : payload.path
    const toPath = targetFolder ? `${targetFolder}/${seg}` : seg
    if (toPath === payload.path) return
    moveDropFolderMut.mutate({ from: payload.path, to: toPath })
  }

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
      document.querySelector('ul[aria-label="档案文件"] [aria-current="page"]')?.scrollIntoView({ block: "center", behavior: "smooth" })
    }))
  }

  const sideHeader = (
    <Stack gap="sm">
      <InputGroup>
        <InputGroupAddon><SearchIcon /></InputGroupAddon>
        <InputGroupInput
          aria-label="搜索档案"
          placeholder="搜索文件名或路径"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
        />
        {query ? (
          <InputGroupAddon align="inline-end">
            <Button size="icon-sm" variant="ghost" aria-label="清除搜索" onClick={() => onQueryChange("")}>
              <XIcon />
            </Button>
          </InputGroupAddon>
        ) : null}
      </InputGroup>
      <Toolbar
        end={
          <>
            <Button size="icon-sm" variant="ghost" aria-label="上传文件" title="上传文件" onClick={() => onTriggerUpload("")}>
              <UploadIcon />
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="新建目录"
              title="新建目录"
              onClick={() => onOpenDialog({ kind: "new-folder", parentPath: "" })}
            >
              <FolderPlusIcon />
            </Button>
            {searching ? null : (
              <>
                <Button size="icon-sm" variant="ghost" aria-label="定位当前文件" title="定位当前文件" onClick={locateCurrent}>
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
        <Select value={kindFilter} onValueChange={onKindFilterChange}>
          <SelectTrigger aria-label="按类型筛选" className="w-36 shrink-0">
            <SelectValue placeholder="全部类型" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部类型</SelectItem>
            {ARCHIVE_KIND_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                <span className="llmwiki-select-option"><WikiFileIcon doc={{ filename: option.filename }} />{option.label}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Toolbar>
    </Stack>
  )

  const empty = searching ? filteredFiles.length === 0 : tree.nodes.length === 0
  const side = (
    <Stack gap="sm">
      {empty ? (
        <EmptyState
          title={searching ? "没有匹配的档案文件" : kindFilter === "all" ? "暂无档案文件" : "没有符合筛选的档案文件"}
          description={searching ? `没有匹配“${query.trim()}”的结果` : kindFilter === "all" ? "点击上方上传按钮或直接拖入文件即可开始。" : undefined}
          action={searching ? undefined : (
            <Button size="sm" variant="outline" onClick={() => onTriggerUpload("")}>
              <UploadIcon />上传文件
            </Button>
          )}
        />
      ) : null}
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          const raw = e.dataTransfer.getData("application/x-llmwiki-archive")
          if (!raw) return
          try {
            const payload = JSON.parse(raw) as ArchiveDragPayload
            if (payload.kind === "file" && payload.folder !== "") {
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
        <NavList label="档案文件">
          {searching ? (
            filteredFiles.map((file) => (
              <NavItem
                key={file.id}
                to={`/archives/${encodeURIComponent(file.id)}`}
                active={file.id === currentId}
                icon={<WikiFileIcon doc={file} />}
                trailing={<span className="text-xs tabular-nums text-muted-foreground">{formatBytes(file.size)}</span>}
              >
                {file.filename}
              </NavItem>
            ))
          ) : (
            <ArchiveTreeRows
              nodes={tree.nodes}
              depth={0}
              isOpen={isOpen}
              toggle={toggle}
              currentId={currentId}
              dragOverKey={dragOverKey}
              setDragOverKey={setDragOverKey}
              onDropOnFolder={handleDropOnFolder}
              onUpload={(folderPath, picked) => { void handleUpload(folderPath, picked) }}
              onOpenDialog={onOpenDialog}
              onTriggerUpload={onTriggerUpload}
              onDeleteFile={(file) => { void handleDeleteFile(file) }}
            />
          )}
        </NavList>
      </div>
    </Stack>
  )

  return { sideHeader, side }
}

function ArchiveFileReader({
  fileId,
  sideHeader,
  side,
  onOpenDialog,
}: {
  fileId: string
  sideHeader: React.ReactNode
  side: React.ReactNode
  onOpenDialog: (state: ArchiveDialogState) => void
}) {
  const navigate = useAppNavigate()
  const confirm = useConfirm()
  const queryClient = useQueryClient()
  const [viewMode, setViewMode] = React.useState<"preview" | "source" | "edit">("preview")
  const [draft, setDraft] = React.useState<string | null>(null)
  const [infoOpen, setInfoOpen] = React.useState(false)

  const detailQuery = useQuery({
    queryKey: ["archive-file", fileId],
    queryFn: () => getArchiveFile(fileId),
  })

  const file = detailQuery.data
  const isTextLike = file ? file.kind === "markdown" || file.kind === "html" || file.kind === "text" : false

  const textQuery = useQuery({
    queryKey: ["archive-file-text", fileId, file?.updated_at],
    queryFn: () => getArchiveFileText(fileId),
    enabled: Boolean(file && isTextLike),
  })

  const activeDraft = draft ?? textQuery.data ?? ""

  const saveContentMut = useMutation({
    mutationFn: () => updateArchiveFileContent(fileId, activeDraft),
    onSuccess: async (res) => {
      if (res.promoted) {
        notify.success("已保存并自动提升至大文件存储")
      } else {
        notify.success("文件内容已保存")
      }
      setViewMode("preview")
      await queryClient.invalidateQueries({ queryKey: ["archive-tree"] })
      await queryClient.invalidateQueries({ queryKey: ["archive-file", fileId] })
      await queryClient.invalidateQueries({ queryKey: ["archive-file-text", fileId] })
    },
    onError: (err: Error) => notify.error(err, "保存内容失败"),
  })

  const deleteMut = useMutation({
    mutationFn: () => deleteArchiveFile(fileId),
    onSuccess: async () => {
      notify.success("文件已删除")
      await queryClient.invalidateQueries({ queryKey: ["archive-tree"] })
      navigate("/archives", { replace: true })
    },
    onError: (err: Error) => notify.error(err, "删除文件失败"),
  })

  if (detailQuery.isLoading) {
    return (
      <Page title="档案" layout="fill">
        <Split sideLabel="档案文件树" sideWidth="lg" collapseBelow={900} sideHeader={sideHeader} side={side}>
          <RowsSkeleton rows={8} />
        </Split>
      </Page>
    )
  }

  if (detailQuery.isError || !file) {
    return (
      <Page title="档案" layout="fill">
        <Split sideLabel="档案文件树" sideWidth="lg" collapseBelow={900} sideHeader={sideHeader} side={side}>
          <ErrorState
            error={detailQuery.error ?? new Error("档案文件不存在")}
            onRetry={() => void detailQuery.refetch()}
          />
        </Split>
      </Page>
    )
  }

  const rawUrl = archiveFileRawUrl(file.id)
  const downloadUrl = archiveFileRawUrl(file.id, true)
  const breadcrumbs = [
    { label: "档案", to: "/archives" },
    ...(file.folder_path
      ? file.folder_path.split("/").map((seg) => ({ label: seg, to: "/archives" }))
      : []),
  ]

  return (
    <Page
      title={file.filename}
      breadcrumbs={breadcrumbs}
      layout="fill"
      actions={[
        ...(file.kind === "markdown" || file.kind === "html"
          ? [
              {
                label: viewMode === "source" ? "预览" : "源码",
                icon: <CodeIcon />,
                onSelect: () => setViewMode((m) => (m === "source" ? "preview" : "source")),
              },
            ]
          : []),
        ...(isTextLike
          ? [
              viewMode === "edit"
                ? {
                    label: "保存",
                    icon: <SaveIcon />,
                    onSelect: () => saveContentMut.mutate(),
                  }
                : {
                    label: "编辑",
                    icon: <PencilIcon />,
                    onSelect: () => {
                      setDraft(textQuery.data ?? "")
                      setViewMode("edit")
                    },
                  },
            ]
          : []),
        {
          label: "移动",
          icon: <FolderIcon />,
          onSelect: () => onOpenDialog({ kind: "move-file", file }),
        },
        {
          label: "下载",
          icon: <DownloadIcon />,
          onSelect: () => {
            window.open(downloadUrl, "_blank", "noopener")
          },
        },
        {
          label: "信息",
          icon: <InfoIcon />,
          iconOnly: true,
          onSelect: () => setInfoOpen(true),
        },
        {
          label: "删除",
          icon: <Trash2Icon />,
          iconOnly: true,
          onSelect: async () => {
            const ok = await confirm({
              title: `删除档案文件「${file.filename}」？`,
              description: "删除后将同时清理对应存储实体，不可撤销。",
              confirmLabel: "删除",
              destructive: true,
            })
            if (ok) deleteMut.mutate()
          },
        },
      ]}
    >
      <Split sideLabel="档案文件树" sideWidth="lg" collapseBelow={900} sideHeader={sideHeader} side={side}>
        <Body width="full" align="start">
          <Stack gap="md">
            <Actions align="between">
              <Actions align="start">
                <Badge variant="outline">{file.kind}</Badge>
                <Badge variant="secondary">{formatBytes(file.size)}</Badge>
                <Badge variant="outline">{backendLabel(file.storage_backend)}</Badge>
              </Actions>
              {viewMode === "edit" && (
                <Actions align="end">
                  <Button size="sm" variant="ghost" onClick={() => setViewMode("preview")}>取消</Button>
                  <Button size="sm" disabled={saveContentMut.isPending} onClick={() => saveContentMut.mutate()}>
                    <SaveIcon />保存修改
                  </Button>
                </Actions>
              )}
            </Actions>

            {viewMode === "edit" && isTextLike ? (
              <Textarea
                rows={22}
                className="font-mono text-xs"
                value={activeDraft}
                onChange={(e) => setDraft(e.target.value)}
              />
            ) : file.kind === "markdown" && viewMode === "preview" ? (
              <Markdown>{textQuery.data ?? ""}</Markdown>
            ) : file.kind === "html" && viewMode === "preview" ? (
              <Panel padding="none">
                <iframe
                  title={file.filename}
                  src={rawUrl}
                  sandbox="allow-scripts"
                  style={{ border: 0 }}
                  className="h-[72vh] w-full bg-background"
                />
              </Panel>
            ) : (file.kind === "markdown" || file.kind === "html" || file.kind === "text") ? (
              <Panel padding="md">
                <pre className="overflow-auto whitespace-pre-wrap break-words font-mono text-xs">
                  {textQuery.isLoading ? "加载中…" : (textQuery.data ?? "")}
                </pre>
              </Panel>
            ) : file.kind === "image" ? (
              <Panel padding="md">
                <img src={rawUrl} alt={file.filename} className="max-h-[75vh] max-w-full object-contain" />
              </Panel>
            ) : file.kind === "video" ? (
              <Panel padding="none">
                <video controls preload="metadata" src={rawUrl} className="max-h-[75vh] w-full bg-black" />
              </Panel>
            ) : file.kind === "audio" ? (
              <Panel padding="md">
                <audio controls preload="metadata" src={rawUrl} className="w-full" />
              </Panel>
            ) : file.kind === "pdf" ? (
              <Panel padding="none">
                <iframe title={file.filename} src={rawUrl} style={{ border: 0 }} className="h-[75vh] w-full" />
              </Panel>
            ) : (
              <EmptyState
                title={file.filename}
                description={`类型 ${file.media_type} · 大小 ${formatBytes(file.size)}，暂不支持直接在线预览。`}
                action={
                  <Button asChild variant="outline" size="sm">
                    <a href={downloadUrl} target="_blank" rel="noreferrer">
                      <DownloadIcon />下载文件
                    </a>
                  </Button>
                }
              />
            )}
          </Stack>
        </Body>
      </Split>

      <Dialog open={infoOpen} onOpenChange={setInfoOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>档案文件信息</DialogTitle>
            <DialogDescription>{file.relative_path}</DialogDescription>
          </DialogHeader>
          <Panel padding="none">
            <Rows label="档案属性">
              {[
                { label: "路径", value: file.relative_path },
                { label: "类型", value: `${file.kind} (${file.media_type})` },
                { label: "大小", value: `${formatBytes(file.size)} (${file.size} bytes)` },
                { label: "存储后端", value: backendLabel(file.storage_backend) },
                ...(file.storage_key ? [{ label: "存储键", value: file.storage_key }] : []),
                { label: "SHA-256", value: file.sha256 },
                { label: "来源", value: file.origin },
                { label: "更新时间", value: <Time value={file.updated_at} mode="datetime" /> },
              ].map((item) => (
                <Row key={item.label}>
                  <span className="shrink-0 text-xs text-muted-foreground">{item.label}</span>
                  <span className="min-w-0 flex-1 break-all text-xs">{item.value}</span>
                </Row>
              ))}
              {file.wiki_documents.length > 0 && (
                <Row>
                  <span className="shrink-0 text-xs text-muted-foreground">关联 Wiki</span>
                  <Stack gap="xs">
                    {file.wiki_documents.map((doc) => (
                      <button
                        key={doc.document_id}
                        type="button"
                        onClick={() => {
                          setInfoOpen(false)
                          navigate(`/wiki/${encodeURIComponent(doc.document_id)}`)
                        }}
                        className="text-left text-xs text-primary hover:underline"
                      >
                        <Inline gap="xs">
                          <ExternalLinkIcon className="size-3" />
                          <span>{doc.title || doc.relative_path}</span>
                        </Inline>
                      </button>
                    ))}
                  </Stack>
                </Row>
              )}
            </Rows>
          </Panel>
        </DialogContent>
      </Dialog>
    </Page>
  )
}

export function ArchivesPage() {
  const { id } = useParams()
  const navigate = useAppNavigate()
  const queryClient = useQueryClient()
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const [uploadFolder, setUploadFolder] = React.useState("")
  const [kindFilter, setKindFilter] = React.useState("all")
  const [query, setQuery] = React.useState("")
  const [dialogState, setDialogState] = React.useState<ArchiveDialogState>(null)

  const treeQuery = useQuery({
    queryKey: ["archive-tree"],
    queryFn: () => getArchiveTree(),
  })

  const folders = React.useMemo(() => treeQuery.data?.folders ?? [], [treeQuery.data])
  const files = React.useMemo(() => treeQuery.data?.files ?? [], [treeQuery.data])

  const uploadMut = useMutation({
    mutationFn: ({ picked, folderPath }: { picked: File[]; folderPath: string }) =>
      uploadArchiveFiles(picked, folderPath),
    onSuccess: async (res) => {
      notify.success(`已上传 ${res.files.length} 个文件`)
      await queryClient.invalidateQueries({ queryKey: ["archive-tree"] })
      if (res.files[0]) navigate(`/archives/${encodeURIComponent(res.files[0].id)}`)
    },
    onError: (err: Error) => notify.error(err, "上传失败"),
  })

  function triggerUpload(folderPath: string) {
    setUploadFolder(folderPath)
    fileInputRef.current?.click()
  }

  const pane = useArchivePane({
    folders,
    files,
    currentId: id,
    kindFilter,
    onKindFilterChange: setKindFilter,
    query,
    onQueryChange: setQuery,
    onTriggerUpload: triggerUpload,
    onOpenDialog: setDialogState,
  })

  if (treeQuery.isLoading) {
    return (
      <Page title="档案">
        <RowsSkeleton rows={8} />
      </Page>
    )
  }
  if (treeQuery.isError) {
    return (
      <Page title="档案">
        <ErrorState error={treeQuery.error} onRetry={() => void treeQuery.refetch()} />
      </Page>
    )
  }

  return (
    <div
      className="flex min-h-0 min-w-0 flex-1 flex-col"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        if (e.dataTransfer.files.length > 0) {
          e.preventDefault()
          uploadMut.mutate({ picked: [...e.dataTransfer.files], folderPath: "" })
        }
      }}
    >
      <input
        ref={fileInputRef}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          const picked = [...(e.target.files ?? [])]
          e.target.value = ""
          if (picked.length > 0) uploadMut.mutate({ picked, folderPath: uploadFolder })
        }}
      />

      {id ? (
        <ArchiveFileReader
          key={id}
          fileId={id}
          sideHeader={pane.sideHeader}
          side={pane.side}
          onOpenDialog={setDialogState}
        />
      ) : (
        <Page
          title="档案"
          layout="fill"
          actions={[
            { label: "上传文件", icon: <UploadIcon />, onSelect: () => triggerUpload("") },
            {
              label: "新建目录",
              icon: <FolderPlusIcon />,
              onSelect: () => setDialogState({ kind: "new-folder", parentPath: "" }),
            },
          ]}
        >
          <Split
            sideLabel="档案文件树"
            sideWidth="lg"
            collapseBelow={900}
            sideHeader={pane.sideHeader}
            side={pane.side}
          >
            <Body width="full" align="start">
              <EmptyState
                title="选择一个档案文件"
                description="从左侧文件树选择文件进行预览/编辑，或直接拖拽文件到此处上传。"
                action={
                  <Button size="sm" variant="outline" onClick={() => triggerUpload("")}>
                    <UploadIcon />上传文件
                  </Button>
                }
              />
            </Body>
          </Split>
        </Page>
      )}

      <ArchiveTreeDialogs state={dialogState} folders={folders} onClose={() => setDialogState(null)} />
    </div>
  )
}
