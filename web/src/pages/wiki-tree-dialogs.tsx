import * as React from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { notify } from "@/components/blocks/notify"
import { Actions, Stack } from "@/components/blocks/surfaces"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import {
  archiveDocument,
  createDocument,
  createFolder,
  deleteFolder,
  moveDocument,
  moveFolder,
  reopenDocument,
  updateFolder,
} from "@/lib/api"
import type { DocumentListItem, FolderDeleteMode, WikiFolder } from "@/types"

export type TreeDialogState =
  | { kind: "create-folder"; parentPath: string }
  | { kind: "edit-folder"; folder: WikiFolder }
  | { kind: "move-folder"; folder: WikiFolder }
  | { kind: "delete-folder"; folder: WikiFolder }
  | { kind: "create-page"; folderPath: string }
  | { kind: "move-doc"; doc: DocumentListItem }
  | { kind: "archive-doc"; doc: DocumentListItem }
  | { kind: "reopen-doc"; doc: DocumentListItem }
  | null

const PAGE_TYPE_OPTIONS = [
  { value: "concept", label: "概念 (concept)" },
  { value: "entity", label: "实体 (entity)" },
  { value: "experience", label: "经验 (experience)" },
  { value: "ledger", label: "台账 (ledger)" },
  { value: "synthesis", label: "综合 (synthesis)" },
  { value: "comparison", label: "对比 (comparison)" },
  { value: "query", label: "问题 (query)" },
  { value: "page", label: "普通页面 (page)" },
]

function useInvalidateTree() {
  const queryClient = useQueryClient()
  return React.useCallback(async (docId?: string) => {
    const tasks: Promise<unknown>[] = [
      queryClient.invalidateQueries({ queryKey: ["wiki-tree"] }),
      queryClient.invalidateQueries({ queryKey: ["documents", "wiki"] }),
      queryClient.invalidateQueries({ queryKey: ["workspace"] }),
    ]
    if (docId) {
      tasks.push(queryClient.invalidateQueries({ queryKey: ["document", docId] }))
    }
    await Promise.all(tasks)
  }, [queryClient])
}

export function WikiTreeDialogs({
  state,
  folders,
  onClose,
  onCreatedDoc,
}: {
  state: TreeDialogState
  folders: WikiFolder[]
  onClose: () => void
  onCreatedDoc: (id: string) => void
}) {
  return (
    <>
      {state?.kind === "create-folder" ? (
        <CreateFolderDialog parentPath={state.parentPath} folders={folders} onClose={onClose} />
      ) : null}
      {state?.kind === "edit-folder" ? (
        <EditFolderDialog folder={state.folder} onClose={onClose} />
      ) : null}
      {state?.kind === "move-folder" ? (
        <MoveFolderDialog folder={state.folder} folders={folders} onClose={onClose} />
      ) : null}
      {state?.kind === "delete-folder" ? (
        <DeleteFolderDialog folder={state.folder} folders={folders} onClose={onClose} />
      ) : null}
      {state?.kind === "create-page" ? (
        <CreatePageDialog folderPath={state.folderPath} folders={folders} onClose={onClose} onCreated={onCreatedDoc} />
      ) : null}
      {state?.kind === "move-doc" ? (
        <MoveDocumentDialog doc={state.doc} folders={folders} onClose={onClose} />
      ) : null}
      {state?.kind === "archive-doc" ? (
        <ArchiveDocumentDialog doc={state.doc} onClose={onClose} />
      ) : null}
      {state?.kind === "reopen-doc" ? (
        <ReopenDocumentDialog doc={state.doc} onClose={onClose} />
      ) : null}
    </>
  )
}

function CreateFolderDialog({
  parentPath,
  folders,
  onClose,
}: {
  parentPath: string
  folders: WikiFolder[]
  onClose: () => void
}) {
  const invalidate = useInvalidateTree()
  const [parent, setParent] = React.useState(parentPath || "__root__")
  const [segment, setSegment] = React.useState("")
  const [displayName, setDisplayName] = React.useState("")
  const [description, setDescription] = React.useState("")

  const mutation = useMutation({
    mutationFn: () => {
      const cleanSeg = segment.trim().replace(/^\/+|\/+$/g, "")
      const fullPath = parent === "__root__" ? cleanSeg : `${parent}/${cleanSeg}`
      const trimmedDisplay = displayName.trim()
      const trimmedDesc = description.trim()
      return createFolder({
        path: fullPath,
        ...(trimmedDisplay ? { display_name: trimmedDisplay } : {}),
        ...(trimmedDesc ? { description: trimmedDesc } : {}),
      })
    },
    onSuccess: async () => {
      notify.success("目录已创建")
      await invalidate()
      onClose()
    },
    onError: (err) => notify.error(err, "创建目录失败"),
  })

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>新建目录</DialogTitle>
          <DialogDescription>按知识主题组织多级目录，支持直接创建子目录。</DialogDescription>
        </DialogHeader>
        <Stack gap="md">
          <Stack gap="xs">
            <Label htmlFor="create-folder-parent">上级目录</Label>
            <Select value={parent} onValueChange={setParent}>
              <SelectTrigger id="create-folder-parent"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__root__">（根目录）</SelectItem>
                {folders.map((f) => (
                  <SelectItem key={f.path} value={f.path}>
                    {f.display_name ? `${f.path} (${f.display_name})` : f.path}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Stack>
          <Stack gap="xs">
            <Label htmlFor="create-folder-name">目录名（路径段）</Label>
            <Input
              id="create-folder-name"
              placeholder="例如：AI工程 或 Agent/Memory"
              value={segment}
              onChange={(e) => setSegment(e.target.value)}
            />
          </Stack>
          <Stack gap="xs">
            <Label htmlFor="create-folder-display">显示名称（可选）</Label>
            <Input
              id="create-folder-display"
              placeholder="留空则显示路径末段名"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </Stack>
          <Stack gap="xs">
            <Label htmlFor="create-folder-desc">目录说明（可选，用于辅助 Agent 自动归类）</Label>
            <Textarea
              id="create-folder-desc"
              rows={2}
              placeholder="简要说明该目录收录的主题范围"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Stack>
          <Actions align="end">
            <Button variant="outline" onClick={onClose}>取消</Button>
            <Button disabled={!segment.trim() || mutation.isPending} onClick={() => mutation.mutate()}>
              创建
            </Button>
          </Actions>
        </Stack>
      </DialogContent>
    </Dialog>
  )
}

function EditFolderDialog({ folder, onClose }: { folder: WikiFolder; onClose: () => void }) {
  const invalidate = useInvalidateTree()
  const [displayName, setDisplayName] = React.useState(folder.display_name)
  const [description, setDescription] = React.useState(folder.description)
  const [sortOrder, setSortOrder] = React.useState(String(folder.sort_order))

  const mutation = useMutation({
    mutationFn: () =>
      updateFolder({
        path: folder.path,
        display_name: displayName,
        description,
        sort_order: Number.parseInt(sortOrder, 10) || 0,
      }),
    onSuccess: async () => {
      notify.success("目录信息已更新")
      await invalidate()
      onClose()
    },
    onError: (err) => notify.error(err, "更新目录失败"),
  })

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>编辑目录</DialogTitle>
          <DialogDescription>{folder.path}</DialogDescription>
        </DialogHeader>
        <Stack gap="md">
          <Stack gap="xs">
            <Label htmlFor="edit-folder-display">显示名称</Label>
            <Input id="edit-folder-display" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </Stack>
          <Stack gap="xs">
            <Label htmlFor="edit-folder-desc">目录说明</Label>
            <Textarea id="edit-folder-desc" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
          </Stack>
          <Stack gap="xs">
            <Label htmlFor="edit-folder-sort">排序权重（越小越靠前）</Label>
            <Input id="edit-folder-sort" type="number" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
          </Stack>
          <Actions align="end">
            <Button variant="outline" onClick={onClose}>取消</Button>
            <Button disabled={mutation.isPending} onClick={() => mutation.mutate()}>保存</Button>
          </Actions>
        </Stack>
      </DialogContent>
    </Dialog>
  )
}

function MoveFolderDialog({
  folder,
  folders,
  onClose,
}: {
  folder: WikiFolder
  folders: WikiFolder[]
  onClose: () => void
}) {
  const invalidate = useInvalidateTree()
  const initialParent = folder.path.includes("/") ? folder.path.slice(0, folder.path.lastIndexOf("/")) : "__root__"
  const initialName = folder.path.includes("/") ? folder.path.slice(folder.path.lastIndexOf("/") + 1) : folder.path
  const [parent, setParent] = React.useState(initialParent)
  const [name, setName] = React.useState(initialName)

  const eligibleTargets = folders.filter(
    (f) => f.path !== folder.path && !f.path.startsWith(`${folder.path}/`),
  )

  const mutation = useMutation({
    mutationFn: () => {
      const cleanName = name.trim().replace(/^\/+|\/+$/g, "")
      const toPath = parent === "__root__" ? cleanName : `${parent}/${cleanName}`
      return moveFolder({ from_path: folder.path, to_path: toPath })
    },
    onSuccess: async (res) => {
      notify.success(`已移动目录（包含 ${res.moved_documents} 个页面）`)
      await invalidate()
      onClose()
    },
    onError: (err) => notify.error(err, "移动目录失败"),
  })

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>移动 / 重命名目录</DialogTitle>
          <DialogDescription>将同步迁移目录下所有子目录与页面，并自动更新引用链接。</DialogDescription>
        </DialogHeader>
        <Stack gap="md">
          <Stack gap="xs">
            <Label htmlFor="move-folder-parent">目标上级目录</Label>
            <Select value={parent} onValueChange={setParent}>
              <SelectTrigger id="move-folder-parent"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__root__">（根目录）</SelectItem>
                {eligibleTargets.map((f) => (
                  <SelectItem key={f.path} value={f.path}>{f.path}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Stack>
          <Stack gap="xs">
            <Label htmlFor="move-folder-name">目录名</Label>
            <Input id="move-folder-name" value={name} onChange={(e) => setName(e.target.value)} />
          </Stack>
          <Actions align="end">
            <Button variant="outline" onClick={onClose}>取消</Button>
            <Button disabled={!name.trim() || mutation.isPending} onClick={() => mutation.mutate()}>确认移动</Button>
          </Actions>
        </Stack>
      </DialogContent>
    </Dialog>
  )
}

function DeleteFolderDialog({
  folder,
  folders,
  onClose,
}: {
  folder: WikiFolder
  folders: WikiFolder[]
  onClose: () => void
}) {
  const invalidate = useInvalidateTree()
  const hasChildren = folder.total_count > 0 || folders.some((f) => f.path.startsWith(`${folder.path}/`))
  const hasParent = folder.path.includes("/")
  const [mode, setMode] = React.useState<FolderDeleteMode>(hasChildren ? (hasParent ? "move_to_parent" : "cascade") : "empty")
  const eligibleTargets = folders.filter(
    (f) => f.path !== folder.path && !f.path.startsWith(`${folder.path}/`),
  )
  const [targetFolder, setTargetFolder] = React.useState(eligibleTargets[0]?.path ?? "")

  const mutation = useMutation({
    mutationFn: () =>
      deleteFolder({
        path: folder.path,
        mode,
        ...(mode === "move_to_parent" && !hasParent && targetFolder ? { target_folder: targetFolder } : {}),
      }),
    onSuccess: async () => {
      notify.success("目录已删除")
      await invalidate()
      onClose()
    },
    onError: (err) => notify.error(err, "删除目录失败"),
  })

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>删除目录</DialogTitle>
          <DialogDescription>
            {folder.path}（含 {folder.total_count} 个页面）
          </DialogDescription>
        </DialogHeader>
        <Stack gap="md">
          {hasChildren ? (
            <>
              <Stack gap="xs">
                <Label htmlFor="del-folder-mode">处理目录下内容的方式</Label>
                <Select value={mode} onValueChange={(v) => setMode(v as FolderDeleteMode)}>
                  <SelectTrigger id="del-folder-mode"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="move_to_parent">
                      {hasParent ? "移至上级目录后删除" : "移至指定目录后删除"}
                    </SelectItem>
                    <SelectItem value="cascade">级联删除目录及所有页面（可在历史中恢复）</SelectItem>
                  </SelectContent>
                </Select>
              </Stack>
              {mode === "move_to_parent" && !hasParent ? (
                <Stack gap="xs">
                  <Label htmlFor="del-folder-target">迁移目标目录</Label>
                  <Select value={targetFolder} onValueChange={setTargetFolder}>
                    <SelectTrigger id="del-folder-target"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {eligibleTargets.map((f) => (
                        <SelectItem key={f.path} value={f.path}>{f.path}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Stack>
              ) : null}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">该目录为空，确认后直接移除。</p>
          )}
          <Actions align="end">
            <Button variant="outline" onClick={onClose}>取消</Button>
            <Button
              variant={mode === "cascade" ? "destructive" : "default"}
              disabled={mutation.isPending || (mode === "move_to_parent" && !hasParent && !targetFolder)}
              onClick={() => mutation.mutate()}
            >
              确认删除
            </Button>
          </Actions>
        </Stack>
      </DialogContent>
    </Dialog>
  )
}

function CreatePageDialog({
  folderPath,
  folders,
  onClose,
  onCreated,
}: {
  folderPath: string
  folders: WikiFolder[]
  onClose: () => void
  onCreated: (id: string) => void
}) {
  const invalidate = useInvalidateTree()
  const [folder, setFolder] = React.useState(folderPath || folders[0]?.path || "inbox")
  const [title, setTitle] = React.useState("")
  const [filename, setFilename] = React.useState("")
  const [pageType, setPageType] = React.useState("concept")
  const [expKind, setExpKind] = React.useState("practice")
  const [symptomsInput, setSymptomsInput] = React.useState("")

  const mutation = useMutation({
    mutationFn: () => {
      const cleanTitle = title.trim()
      let file = filename.trim() || `${cleanTitle.replace(/\s+/g, "-")}.md`
      if (!file.toLowerCase().endsWith(".md")) file += ".md"
      const today = new Date().toISOString().slice(0, 10)
      let content = `---\ntitle: ${cleanTitle}\ntype: ${pageType}\ndate: ${today}\ntags: []\n---\n\n# ${cleanTitle}\n\n`
      if (pageType === "experience") {
        const symptoms = symptomsInput
          .split(/[,，]/)
          .map((s) => s.trim())
          .filter(Boolean)
        const symptomsLine = symptoms.length > 0 ? `symptoms: [${symptoms.join(", ")}]\n` : ""
        content =
          `---\ntitle: ${cleanTitle}\ntype: experience\nkind: ${expKind}\nstatus: draft\nconfidence: medium\n` +
          `date: ${today}\nlast_verified: ${today}\n${symptomsLine}tags: []\n---\n\n# ${cleanTitle}\n\n` +
          (expKind === "pitfall"
            ? "## 现象与触发条件\n\n## 根因分析\n\n## 解决方案\n\n## 预防措施\n\n"
            : "## 适用场景\n\n## 核心做法\n\n## 注意事项\n\n")
      } else if (pageType === "ledger") {
        content =
          `---\ntitle: ${cleanTitle}\ntype: ledger\nconfidence: high\ndate: ${today}\nlast_verified: ${today}\ntags: []\n---\n\n` +
          `# ${cleanTitle}\n\n## 台账概览\n\n## 条目清单\n\n| 名称 | 状态 | 更新时间 | 备注 |\n| --- | --- | --- | --- |\n\n`
      }
      return createDocument({
        filename: file,
        path: `/wiki/${folder.replace(/^\/+|\/+$/g, "")}`,
        title: cleanTitle,
        page_type: pageType,
        content,
      })
    },
    onSuccess: async (doc) => {
      notify.success("页面已创建")
      await invalidate(doc.id)
      onClose()
      onCreated(doc.id)
    },
    onError: (err) => notify.error(err, "创建页面失败"),
  })

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>新建页面</DialogTitle>
          <DialogDescription>在指定主题目录下创建新的 Wiki 页面。</DialogDescription>
        </DialogHeader>
        <Stack gap="md">
          <Stack gap="xs">
            <Label htmlFor="create-page-folder">所属目录</Label>
            <Input id="create-page-folder" value={folder} onChange={(e) => setFolder(e.target.value)} />
          </Stack>
          <Stack gap="xs">
            <Label htmlFor="create-page-title">页面标题</Label>
            <Input id="create-page-title" placeholder="例如：Attention Mechanism" value={title} onChange={(e) => setTitle(e.target.value)} />
          </Stack>
          <Stack gap="xs">
            <Label htmlFor="create-page-file">文件名（可选）</Label>
            <Input id="create-page-file" placeholder="留空则按标题生成 .md 文件名" value={filename} onChange={(e) => setFilename(e.target.value)} />
          </Stack>
          <Stack gap="xs">
            <Label htmlFor="create-page-type">页面类型</Label>
            <Select value={pageType} onValueChange={setPageType}>
              <SelectTrigger id="create-page-type"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PAGE_TYPE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Stack>
          {pageType === "experience" ? (
            <>
              <Stack gap="xs">
                <Label htmlFor="create-page-exp-kind">经验子类</Label>
                <Select value={expKind} onValueChange={setExpKind}>
                  <SelectTrigger id="create-page-exp-kind"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="practice">最佳实践 (practice)</SelectItem>
                    <SelectItem value="pitfall">踩坑记录 (pitfall)</SelectItem>
                    <SelectItem value="pattern">可复用模式 (pattern)</SelectItem>
                  </SelectContent>
                </Select>
              </Stack>
              <Stack gap="xs">
                <Label htmlFor="create-page-symptoms">现象关键词（可选，逗号分隔）</Label>
                <Input
                  id="create-page-symptoms"
                  placeholder="例如：connection refused, ECONNRESET"
                  value={symptomsInput}
                  onChange={(e) => setSymptomsInput(e.target.value)}
                />
              </Stack>
            </>
          ) : null}
          <Actions align="end">
            <Button variant="outline" onClick={onClose}>取消</Button>
            <Button disabled={!title.trim() || !folder.trim() || mutation.isPending} onClick={() => mutation.mutate()}>
              创建
            </Button>
          </Actions>
        </Stack>
      </DialogContent>
    </Dialog>
  )
}

function MoveDocumentDialog({
  doc,
  folders,
  onClose,
}: {
  doc: DocumentListItem
  folders: WikiFolder[]
  onClose: () => void
}) {
  const invalidate = useInvalidateTree()
  const currentFolder = React.useMemo(() => {
    const rel = (doc.relative_path ?? "").replace(/^\/+/, "").replace(/^wiki\//, "")
    const idx = rel.lastIndexOf("/")
    return idx >= 0 ? rel.slice(0, idx) : ""
  }, [doc.relative_path])

  const [targetFolder, setTargetFolder] = React.useState(currentFolder || folders[0]?.path || "")
  const [filename, setFilename] = React.useState(doc.filename)

  const mutation = useMutation({
    mutationFn: () =>
      moveDocument(doc.id, {
        target_folder: targetFolder.trim(),
        ...(filename.trim() ? { filename: filename.trim() } : {}),
      }),
    onSuccess: async (res) => {
      notify.success(
        res.updated_link_count > 0
          ? `已移动页面，并自动更新 ${res.updated_link_count} 处引用`
          : "页面已移动",
      )
      await invalidate(doc.id)
      onClose()
    },
    onError: (err) => notify.error(err, "移动页面失败"),
  })

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>移动 / 重命名页面</DialogTitle>
          <DialogDescription>{doc.title || doc.filename}</DialogDescription>
        </DialogHeader>
        <Stack gap="md">
          <Stack gap="xs">
            <Label htmlFor="move-doc-folder">目标目录</Label>
            <Select value={targetFolder} onValueChange={setTargetFolder}>
              <SelectTrigger id="move-doc-folder"><SelectValue /></SelectTrigger>
              <SelectContent>
                {folders.map((f) => (
                  <SelectItem key={f.path} value={f.path}>
                    {f.display_name ? `${f.path} (${f.display_name})` : f.path}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Stack>
          <Stack gap="xs">
            <Label htmlFor="move-doc-filename">文件名</Label>
            <Input id="move-doc-filename" value={filename} onChange={(e) => setFilename(e.target.value)} />
          </Stack>
          <Actions align="end">
            <Button variant="outline" onClick={onClose}>取消</Button>
            <Button disabled={!targetFolder.trim() || mutation.isPending} onClick={() => mutation.mutate()}>
              确认移动
            </Button>
          </Actions>
        </Stack>
      </DialogContent>
    </Dialog>
  )
}

function ArchiveDocumentDialog({
  doc,
  onClose,
}: {
  doc: DocumentListItem
  onClose: () => void
}) {
  const invalidate = useInvalidateTree()
  const [reason, setReason] = React.useState("")
  const [supersededBy, setSupersededBy] = React.useState("")

  const mutation = useMutation({
    mutationFn: () =>
      archiveDocument(doc.id, {
        reason: reason.trim(),
        ...(supersededBy.trim() ? { superseded_by: supersededBy.trim() } : {}),
      }),
    onSuccess: async () => {
      notify.success("页面已归档")
      await invalidate(doc.id)
      onClose()
    },
    onError: (err) => notify.error(err, "归档失败"),
  })

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>归档页面</DialogTitle>
          <DialogDescription>{doc.title || doc.filename}</DialogDescription>
        </DialogHeader>
        <Stack gap="md">
          <Stack gap="xs">
            <Label htmlFor="archive-doc-reason">归档原因（必填）</Label>
            <Textarea
              id="archive-doc-reason"
              placeholder="例如：已被新架构方案替代，保留作历史参考"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Stack>
          <Stack gap="xs">
            <Label htmlFor="archive-doc-superseded">替代页面（可选）</Label>
            <Input
              id="archive-doc-superseded"
              placeholder="例如：[[新方案页面]] 或 wiki/concepts/new.md"
              value={supersededBy}
              onChange={(e) => setSupersededBy(e.target.value)}
            />
          </Stack>
          <Actions align="end">
            <Button variant="outline" onClick={onClose}>取消</Button>
            <Button disabled={!reason.trim() || mutation.isPending} onClick={() => mutation.mutate()}>
              确认归档
            </Button>
          </Actions>
        </Stack>
      </DialogContent>
    </Dialog>
  )
}

function ReopenDocumentDialog({
  doc,
  onClose,
}: {
  doc: DocumentListItem
  onClose: () => void
}) {
  const invalidate = useInvalidateTree()
  const [reason, setReason] = React.useState("")
  const [confidence, setConfidence] = React.useState(doc.confidence || "medium")
  const [lastVerified, setLastVerified] = React.useState(() => new Date().toISOString().slice(0, 10))
  const [reviewAfter, setReviewAfter] = React.useState("")

  const mutation = useMutation({
    mutationFn: () =>
      reopenDocument(doc.id, {
        ...(reason.trim() ? { reason: reason.trim() } : {}),
        ...(confidence ? { confidence } : {}),
        ...(lastVerified.trim() ? { last_verified: lastVerified.trim() } : {}),
        ...(reviewAfter.trim() ? { review_after: reviewAfter.trim() } : {}),
      }),
    onSuccess: async () => {
      notify.success("页面已重新启用")
      await invalidate(doc.id)
      onClose()
    },
    onError: (err) => notify.error(err, "重新启用失败"),
  })

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>重新启用页面</DialogTitle>
          <DialogDescription>{doc.title || doc.filename}</DialogDescription>
        </DialogHeader>
        <Stack gap="md">
          <Stack gap="xs">
            <Label htmlFor="reopen-doc-reason">重开原因（可选）</Label>
            <Input
              id="reopen-doc-reason"
              placeholder="例如：旧方案重新恢复使用"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Stack>
          <Stack gap="xs">
            <Label htmlFor="reopen-doc-confidence">置信度</Label>
            <Select value={confidence} onValueChange={setConfidence}>
              <SelectTrigger id="reopen-doc-confidence"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="high">高置信 (high)</SelectItem>
                <SelectItem value="medium">中置信 (medium)</SelectItem>
                <SelectItem value="low">低置信 (low)</SelectItem>
              </SelectContent>
            </Select>
          </Stack>
          <Stack gap="xs">
            <Label htmlFor="reopen-doc-verified">最近核实日期</Label>
            <Input id="reopen-doc-verified" value={lastVerified} onChange={(e) => setLastVerified(e.target.value)} />
          </Stack>
          <Stack gap="xs">
            <Label htmlFor="reopen-doc-review-after">下次复审日期（可选，YYYY-MM-DD）</Label>
            <Input id="reopen-doc-review-after" placeholder="YYYY-MM-DD" value={reviewAfter} onChange={(e) => setReviewAfter(e.target.value)} />
          </Stack>
          <Actions align="end">
            <Button variant="outline" onClick={onClose}>取消</Button>
            <Button disabled={mutation.isPending} onClick={() => mutation.mutate()}>
              确认启用
            </Button>
          </Actions>
        </Stack>
      </DialogContent>
    </Dialog>
  )
}
