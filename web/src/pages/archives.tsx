import * as React from "react"
import { useParams } from "react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  CodeIcon,
  DownloadIcon,
  ExternalLinkIcon,
  FileAudioIcon,
  FileCodeIcon,
  FileIcon,
  FileImageIcon,
  FileTextIcon,
  FileVideoIcon,
  FoldVerticalIcon,
  FolderIcon,
  FolderOpenIcon,
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
import { ArchiveTreeDialogs, type ArchiveDialogState } from "@/pages/archive-dialogs"
import type { ArchiveFile, ArchiveFileKind, ArchiveFolder } from "@/types"

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

function ArchiveKindIcon({ kind }: { kind: ArchiveFileKind }) {
  switch (kind) {
    case "markdown":
    case "text":
      return <FileTextIcon className="llmwiki-tone-indigo" />
    case "html":
      return <FileCodeIcon className="llmwiki-tone-amber" />
    case "image":
      return <FileImageIcon className="llmwiki-tone-emerald" />
    case "video":
      return <FileVideoIcon className="llmwiki-tone-rose" />
    case "audio":
      return <FileAudioIcon className="llmwiki-tone-cyan" />
    case "pdf":
      return <FileTextIcon className="llmwiki-tone-violet" />
    default:
      return <FileIcon className="llmwiki-tone-slate" />
  }
}

type TreeNode = {
  key: string
  segment: string
  folderPath?: string | undefined
  folder?: ArchiveFolder | undefined
  file?: ArchiveFile | undefined
  children?: TreeNode[] | undefined
}

function buildArchiveTree(folders: ArchiveFolder[], files: ArchiveFile[]) {
  const folderMap = new Map<string, ArchiveFolder>()
  for (const f of folders) folderMap.set(f.path, f)

  const rootChildren: TreeNode[] = []
  const nodeMap = new Map<string, TreeNode>()

  function ensureFolderNode(folderPath: string): TreeNode {
    const existing = nodeMap.get(`dir:${folderPath}`)
    if (existing) return existing
    const parts = folderPath.split("/")
    const segment = parts[parts.length - 1] ?? folderPath
    const node: TreeNode = {
      key: `dir:${folderPath}`,
      segment,
      folderPath,
      folder: folderMap.get(folderPath),
      children: [],
    }
    nodeMap.set(node.key, node)
    if (parts.length === 1) {
      rootChildren.push(node)
    } else {
      const parent = ensureFolderNode(parts.slice(0, -1).join("/"))
      parent.children!.push(node)
    }
    return node
  }

  for (const f of folders) ensureFolderNode(f.path)
  for (const file of files) {
    const fileNode: TreeNode = {
      key: `file:${file.id}`,
      segment: file.filename,
      file,
    }
    if (!file.folder_path) {
      rootChildren.push(fileNode)
    } else {
      const parent = ensureFolderNode(file.folder_path)
      parent.children!.push(fileNode)
    }
  }

  const sortNodes = (list: TreeNode[]) => {
    list.sort((a, b) => {
      const aDir = a.folderPath !== undefined
      const bDir = b.folderPath !== undefined
      if (aDir !== bDir) return aDir ? -1 : 1
      return a.segment.localeCompare(b.segment, "zh-Hans-CN")
    })
    for (const item of list) {
      if (item.children) sortNodes(item.children)
    }
  }
  sortNodes(rootChildren)
  return rootChildren
}

function ArchivePane({
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
  currentId?: string
  kindFilter: string
  onKindFilterChange: (v: string) => void
  query: string
  onQueryChange: (v: string) => void
  onTriggerUpload: (folderPath: string) => void
  onOpenDialog: (state: ArchiveDialogState) => void
}) {
  const navigate = useAppNavigate()
  const queryClient = useQueryClient()
  const [expanded, setExpanded] = React.useState<Set<string>>(() => new Set())

  const filteredFiles = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    return files.filter((f) => {
      if (kindFilter !== "all" && f.kind !== kindFilter) return false
      if (q && !f.relative_path.toLowerCase().includes(q) && !f.filename.toLowerCase().includes(q)) return false
      return true
    })
  }, [files, kindFilter, query])

  const treeNodes = React.useMemo(() => buildArchiveTree(folders, filteredFiles), [folders, filteredFiles])

  const ancestorFolders = React.useMemo(() => {
    const out = new Set<string>()
    if (!currentId) return out
    const current = files.find((f) => f.id === currentId)
    if (!current?.folder_path) return out
    const parts = current.folder_path.split("/")
    for (let i = 1; i <= parts.length; i += 1) {
      out.add(parts.slice(0, i).join("/"))
    }
    return out
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

  function toggleFolder(folderPath: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(folderPath)) next.delete(folderPath)
      else next.add(folderPath)
      return next
    })
  }

  function renderNode(node: TreeNode, depth: number): React.ReactNode {
    if (node.folderPath !== undefined) {
      const fp = node.folderPath
      const isOpen = expanded.has(fp) || ancestorFolders.has(fp) || query.trim() !== ""
      const label = node.folder?.display_name || node.segment
      return (
        <div
          key={node.key}
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData("application/x-llmwiki-archive", JSON.stringify({ kind: "folder", path: fp }))
          }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault()
            e.stopPropagation()
            if (e.dataTransfer.files.length > 0) {
              void uploadArchiveFiles([...e.dataTransfer.files], fp).then(async () => {
                notify.success(`已上传到 ${fp}`)
                await queryClient.invalidateQueries({ queryKey: ["archive-tree"] })
              })
              return
            }
            const raw = e.dataTransfer.getData("application/x-llmwiki-archive")
            if (!raw) return
            const payload = JSON.parse(raw) as { kind: "file" | "folder"; id?: string; path?: string }
            if (payload.kind === "file" && payload.id) {
              moveDropFileMut.mutate({ id: payload.id, folder: fp })
            } else if (payload.kind === "folder" && payload.path && payload.path !== fp) {
              const base = payload.path.split("/").pop() ?? payload.path
              moveDropFolderMut.mutate({ from: payload.path, to: `${fp}/${base}` })
            }
          }}
        >
          <NavItem
            active={false}
            depth={depth}
            icon={isOpen ? <FolderOpenIcon className="llmwiki-tone-amber" /> : <FolderIcon className="llmwiki-tone-amber" />}
            onSelect={() => toggleFolder(fp)}
            trailing={
              <Actions align="end">
                {node.folder?.total_count ? (
                  <span className="text-xs text-muted-foreground">{node.folder.total_count}</span>
                ) : null}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`目录操作 ${fp}`}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <MoreHorizontalIcon />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => onTriggerUpload(fp)}>
                      <UploadIcon />上传到此目录
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => onOpenDialog({ kind: "new-folder", parentPath: fp })}>
                      <FolderPlusIcon />新建子目录
                    </DropdownMenuItem>
                    {node.folder && (
                      <>
                        <DropdownMenuItem onSelect={() => onOpenDialog({ kind: "rename-folder", folder: node.folder! })}>
                          <PencilIcon />重命名显示名
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => onOpenDialog({ kind: "move-folder", folder: node.folder! })}>
                          <FolderIcon />移动目录路径
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onSelect={() => onOpenDialog({ kind: "delete-folder", folder: node.folder! })}>
                          <Trash2Icon />删除目录
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </Actions>
            }
          >
            {label}
          </NavItem>
          {isOpen && node.children?.map((child) => renderNode(child, depth + 1))}
        </div>
      )
    }

    const file = node.file!
    return (
      <div
        key={node.key}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData("application/x-llmwiki-archive", JSON.stringify({ kind: "file", id: file.id }))
        }}
      >
        <NavItem
          active={file.id === currentId}
          depth={depth}
          icon={<ArchiveKindIcon kind={file.kind} />}
          trailing={formatBytes(file.size)}
          onSelect={() => navigate(`/archives/${encodeURIComponent(file.id)}`)}
        >
          {file.filename}
        </NavItem>
      </div>
    )
  }

  return (
    <Stack gap="sm">
      <InputGroup>
        <InputGroupAddon align="inline-start">
          <SearchIcon />
        </InputGroupAddon>
        <InputGroupInput
          placeholder="搜索档案文件名或路径…"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
        />
        {query && (
          <InputGroupAddon align="inline-end">
            <Button size="icon-sm" variant="ghost" aria-label="清除搜索" onClick={() => onQueryChange("")}>
              <XIcon />
            </Button>
          </InputGroupAddon>
        )}
      </InputGroup>

      <Toolbar>
        <Select value={kindFilter} onValueChange={onKindFilterChange}>
          <SelectTrigger aria-label="按类型筛选" className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部类型</SelectItem>
            <SelectItem value="markdown">Markdown</SelectItem>
            <SelectItem value="html">HTML</SelectItem>
            <SelectItem value="image">图片</SelectItem>
            <SelectItem value="video">视频</SelectItem>
            <SelectItem value="audio">音频</SelectItem>
            <SelectItem value="pdf">PDF</SelectItem>
            <SelectItem value="text">文本/代码</SelectItem>
            <SelectItem value="other">其他</SelectItem>
          </SelectContent>
        </Select>
        <Actions align="end">
          <Button size="icon-sm" variant="ghost" title="上传文件" onClick={() => onTriggerUpload("")}>
            <UploadIcon />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            title="新建目录"
            onClick={() => onOpenDialog({ kind: "new-folder", parentPath: "" })}
          >
            <FolderPlusIcon />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            title="全部展开"
            onClick={() => setExpanded(new Set(folders.map((f) => f.path)))}
          >
            <UnfoldVerticalIcon />
          </Button>
          <Button size="icon-sm" variant="ghost" title="全部折叠" onClick={() => setExpanded(new Set())}>
            <FoldVerticalIcon />
          </Button>
          {currentId && (
            <Button
              size="icon-sm"
              variant="ghost"
              title="定位当前文件"
              onClick={() => {
                const cur = files.find((f) => f.id === currentId)
                if (!cur?.folder_path) return
                const parts = cur.folder_path.split("/")
                setExpanded((prev) => {
                  const next = new Set(prev)
                  for (let i = 1; i <= parts.length; i += 1) next.add(parts.slice(0, i).join("/"))
                  return next
                })
              }}
            >
              <LocateFixedIcon />
            </Button>
          )}
        </Actions>
      </Toolbar>

      {treeNodes.length === 0 ? (
        <EmptyState
          title="暂无档案文件"
          description="点击上方上传按钮或直接拖入文件即可开始。"
          action={
            <Button size="sm" variant="outline" onClick={() => onTriggerUpload("")}>
              <UploadIcon />上传文件
            </Button>
          }
        />
      ) : (
        <NavList label="档案文件树">
          {treeNodes.map((n) => renderNode(n, 0))}
        </NavList>
      )}
    </Stack>
  )
}

function ArchiveFileReader({
  fileId,
  folders,
  files,
  kindFilter,
  onKindFilterChange,
  query,
  onQueryChange,
  onTriggerUpload,
  onOpenDialog,
}: {
  fileId: string
  folders: ArchiveFolder[]
  files: ArchiveFile[]
  kindFilter: string
  onKindFilterChange: (v: string) => void
  query: string
  onQueryChange: (v: string) => void
  onTriggerUpload: (folderPath: string) => void
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

  const pane = (
    <ArchivePane
      folders={folders}
      files={files}
      currentId={fileId}
      kindFilter={kindFilter}
      onKindFilterChange={onKindFilterChange}
      query={query}
      onQueryChange={onQueryChange}
      onTriggerUpload={onTriggerUpload}
      onOpenDialog={onOpenDialog}
    />
  )

  if (detailQuery.isLoading) {
    return (
      <Page title="档案" layout="fill">
        <Split sideLabel="档案文件树" sideWidth="lg" collapseBelow={900} side={pane}>
          <RowsSkeleton rows={8} />
        </Split>
      </Page>
    )
  }

  if (detailQuery.isError || !file) {
    return (
      <Page title="档案" layout="fill">
        <Split sideLabel="档案文件树" sideWidth="lg" collapseBelow={900} side={pane}>
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
      <Split sideLabel="档案文件树" sideWidth="lg" collapseBelow={900} side={pane}>
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

  if (treeQuery.isLoading) return <RowsSkeleton rows={8} />
  if (treeQuery.isError) return <ErrorState error={treeQuery.error} onRetry={() => void treeQuery.refetch()} />

  return (
    <div
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
          folders={folders}
          files={files}
          kindFilter={kindFilter}
          onKindFilterChange={setKindFilter}
          query={query}
          onQueryChange={setQuery}
          onTriggerUpload={triggerUpload}
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
            side={
              <ArchivePane
                folders={folders}
                files={files}
                kindFilter={kindFilter}
                onKindFilterChange={setKindFilter}
                query={query}
                onQueryChange={setQuery}
                onTriggerUpload={triggerUpload}
                onOpenDialog={setDialogState}
              />
            }
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
