import * as React from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { notify } from "@/components/blocks/notify"
import { Actions, Stack } from "@/components/blocks/surfaces"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  createArchiveFolder,
  deleteArchiveFolder,
  moveArchiveFolder,
  updateArchiveFileLocation,
  updateArchiveFolder,
} from "@/lib/api"
import type { ArchiveFile, ArchiveFolder, FolderDeleteMode } from "@/types"

export type ArchiveDialogState =
  | { kind: "new-folder"; parentPath: string }
  | { kind: "rename-folder"; folder: ArchiveFolder }
  | { kind: "move-folder"; folder: ArchiveFolder }
  | { kind: "delete-folder"; folder: ArchiveFolder }
  | { kind: "move-file"; file: ArchiveFile }
  | null

export function ArchiveTreeDialogs({
  state,
  folders,
  onClose,
}: {
  state: ArchiveDialogState
  folders: ArchiveFolder[]
  onClose: () => void
}) {
  if (!state) return null
  const dialogKey =
    state.kind === "new-folder"
      ? `new:${state.parentPath}`
      : state.kind === "move-file"
        ? `file:${state.file.id}`
        : `${state.kind}:${state.folder.path}`
  return <ArchiveTreeDialogInner key={dialogKey} state={state} folders={folders} onClose={onClose} />
}

function ArchiveTreeDialogInner({
  state,
  folders,
  onClose,
}: {
  state: NonNullable<ArchiveDialogState>
  folders: ArchiveFolder[]
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [name, setName] = React.useState(() => {
    if (state.kind === "rename-folder") {
      return state.folder.display_name || state.folder.path.split("/").pop() || ""
    }
    if (state.kind === "move-file") return state.file.filename
    return ""
  })
  const [targetFolder, setTargetFolder] = React.useState(() => {
    if (state.kind === "new-folder") return state.parentPath
    if (state.kind === "move-folder") return state.folder.path
    if (state.kind === "move-file") return state.file.folder_path || "__root__"
    return ""
  })
  const [deleteMode, setDeleteMode] = React.useState<FolderDeleteMode>("empty")

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["archive-tree"] })

  const createFolderMut = useMutation({
    mutationFn: () => {
      const clean = name.trim().replace(/^\/+|\/+$/g, "")
      const fullPath = targetFolder ? `${targetFolder}/${clean}` : clean
      return createArchiveFolder({ path: fullPath })
    },
    onSuccess: async () => {
      notify.success("目录已创建")
      await invalidate()
      onClose()
    },
    onError: (err: Error) => notify.error(err, "创建目录失败"),
  })

  const renameFolderMut = useMutation({
    mutationFn: () => {
      if (state?.kind !== "rename-folder") throw new Error("invalid state")
      return updateArchiveFolder({ path: state.folder.path, display_name: name.trim() })
    },
    onSuccess: async () => {
      notify.success("目录已更新")
      await invalidate()
      onClose()
    },
    onError: (err: Error) => notify.error(err, "更新目录失败"),
  })

  const moveFolderMut = useMutation({
    mutationFn: () => {
      if (state?.kind !== "move-folder") throw new Error("invalid state")
      return moveArchiveFolder(state.folder.path, targetFolder.trim())
    },
    onSuccess: async () => {
      notify.success("目录已移动")
      await invalidate()
      onClose()
    },
    onError: (err: Error) => notify.error(err, "移动目录失败"),
  })

  const deleteFolderMut = useMutation({
    mutationFn: () => {
      if (state?.kind !== "delete-folder") throw new Error("invalid state")
      return deleteArchiveFolder(state.folder.path, deleteMode)
    },
    onSuccess: async () => {
      notify.success("目录已删除")
      await invalidate()
      onClose()
    },
    onError: (err: Error) => notify.error(err, "删除目录失败"),
  })

  const moveFileMut = useMutation({
    mutationFn: () => {
      if (state?.kind !== "move-file") throw new Error("invalid state")
      const nextFolder = targetFolder === "__root__" ? "" : targetFolder
      return updateArchiveFileLocation(state.file.id, {
        folder_path: nextFolder,
        filename: name.trim(),
      })
    },
    onSuccess: async (updated) => {
      notify.success("文件位置已更新")
      await invalidate()
      await queryClient.invalidateQueries({ queryKey: ["archive-file", updated.id] })
      onClose()
    },
    onError: (err: Error) => notify.error(err, "移动/重命名文件失败"),
  })

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="sm:max-w-md">
        {state.kind === "new-folder" && (
          <>
            <DialogHeader>
              <DialogTitle>新建档案目录</DialogTitle>
              <DialogDescription>
                {state.parentPath ? `父目录：${state.parentPath}/` : "创建在根目录"}
              </DialogDescription>
            </DialogHeader>
            <Stack gap="sm">
              <Input
                autoFocus
                placeholder="输入目录名称（支持多级如 a/b）"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && name.trim()) createFolderMut.mutate()
                }}
              />
            </Stack>
            <DialogFooter>
              <Actions align="end">
                <Button variant="ghost" onClick={onClose}>取消</Button>
                <Button disabled={!name.trim() || createFolderMut.isPending} onClick={() => createFolderMut.mutate()}>
                  创建
                </Button>
              </Actions>
            </DialogFooter>
          </>
        )}

        {state.kind === "rename-folder" && (
          <>
            <DialogHeader>
              <DialogTitle>重命名目录显示名</DialogTitle>
              <DialogDescription>{state.folder.path}</DialogDescription>
            </DialogHeader>
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && name.trim()) renameFolderMut.mutate()
              }}
            />
            <DialogFooter>
              <Actions align="end">
                <Button variant="ghost" onClick={onClose}>取消</Button>
                <Button disabled={!name.trim() || renameFolderMut.isPending} onClick={() => renameFolderMut.mutate()}>
                  保存
                </Button>
              </Actions>
            </DialogFooter>
          </>
        )}

        {state.kind === "move-folder" && (
          <>
            <DialogHeader>
              <DialogTitle>移动 / 重命名目录路径</DialogTitle>
              <DialogDescription>原路径：{state.folder.path}</DialogDescription>
            </DialogHeader>
            <Input
              autoFocus
              value={targetFolder}
              onChange={(e) => setTargetFolder(e.target.value)}
              placeholder="输入新路径，如 docs/archive"
            />
            <DialogFooter>
              <Actions align="end">
                <Button variant="ghost" onClick={onClose}>取消</Button>
                <Button disabled={!targetFolder.trim() || moveFolderMut.isPending} onClick={() => moveFolderMut.mutate()}>
                  移动
                </Button>
              </Actions>
            </DialogFooter>
          </>
        )}

        {state.kind === "delete-folder" && (
          <>
            <DialogHeader>
              <DialogTitle>删除目录「{state.folder.path}」</DialogTitle>
              <DialogDescription>选择目录下已有文件的处理方式：</DialogDescription>
            </DialogHeader>
            <Select value={deleteMode} onValueChange={(v) => setDeleteMode(v as FolderDeleteMode)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="empty">仅当目录为空时删除</SelectItem>
                <SelectItem value="move_to_parent">将文件移到上级目录后删除</SelectItem>
                <SelectItem value="cascade">级联删除目录及所有文件</SelectItem>
              </SelectContent>
            </Select>
            <DialogFooter>
              <Actions align="end">
                <Button variant="ghost" onClick={onClose}>取消</Button>
                <Button variant="destructive" disabled={deleteFolderMut.isPending} onClick={() => deleteFolderMut.mutate()}>
                  确认删除
                </Button>
              </Actions>
            </DialogFooter>
          </>
        )}

        {state.kind === "move-file" && (
          <>
            <DialogHeader>
              <DialogTitle>重命名 / 移动文件</DialogTitle>
              <DialogDescription>{state.file.relative_path}</DialogDescription>
            </DialogHeader>
            <Stack gap="sm">
              <Input
                autoFocus
                placeholder="文件名"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <Select value={targetFolder} onValueChange={setTargetFolder}>
                <SelectTrigger><SelectValue placeholder="选择目标目录" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__root__">（根目录）</SelectItem>
                  {folders.map((f) => (
                    <SelectItem key={f.path} value={f.path}>{f.path}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Stack>
            <DialogFooter>
              <Actions align="end">
                <Button variant="ghost" onClick={onClose}>取消</Button>
                <Button disabled={!name.trim() || moveFileMut.isPending} onClick={() => moveFileMut.mutate()}>
                  保存
                </Button>
              </Actions>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
