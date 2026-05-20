import { useEffect, useState, useMemo, type FormEvent } from "react"
import { useApp } from "@/context/AppContext"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import type { Settings, VCStatus } from "@/types"
import { PageContainer } from "@/components/PageContainer"
import { Key, Plus, Pencil, Trash2, X, ExternalLink, GitBranch, History, ShieldOff } from "lucide-react"
import { initVC, getVCStatus, disableVC } from "@/lib/api"
import { navigateTo, workbenchViewHref } from "@/lib/wiki-routes"

type AddFormState = {
  mode: false
} | {
  mode: "add"
  catalog_id: string
  name: string
  api_key: string
  base_url: string
  saving: boolean
  error: string
}

type EditFormState = {
  mode: false
} | {
  mode: "edit"
  id: string
  name: string
  catalog_id: string
  original_catalog_id: string
  api_key: string
  base_url: string
  saving: boolean
  error: string
}

type DeleteConfirmState = {
  id: string
  name: string
} | null

export function SettingsPage() {
  const {
    settings,
    loadSettings,
    saveSettings,
    providers,
    loadProviders,
    instances,
    loadInstances,
    createInstance,
    updateInstance,
    deleteInstance,
    loadModels,
    currentModels,
  } = useApp()

  const [form, setForm] = useState<Partial<Settings> | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [addForm, setAddForm] = useState<AddFormState>({ mode: false })
  const [editForm, setEditForm] = useState<EditFormState>({ mode: false })
  const [deleteConfirm, setDeleteConfirm] = useState<DeleteConfirmState>(null)
  const [vcStatus, setVCStatus] = useState<VCStatus | null>(null)
  const [vcLoading, setVCLoading] = useState(false)
  const [vcDisableConfirm, setVCDisableConfirm] = useState(false)

  useEffect(() => {
    void loadSettings()
    void loadProviders()
    void loadInstances()
    void loadVCStatus()
  }, [loadSettings, loadProviders, loadInstances])

  const loadVCStatus = async () => {
    try {
      const status = await getVCStatus()
      setVCStatus(status)
    } catch {
      // ignore
    }
  }

  const handleVCInit = async () => {
    setVCLoading(true)
    try {
      await initVC()
      await loadVCStatus()
    } catch (err) {
      console.error("VC init failed:", err)
    } finally {
      setVCLoading(false)
    }
  }

  const handleVCDisable = async () => {
    setVCLoading(true)
    try {
      await disableVC()
      setVCDisableConfirm(false)
      await loadVCStatus()
    } catch (err) {
      console.error("VC disable failed:", err)
    } finally {
      setVCLoading(false)
    }
  }

  const mergedForm = useMemo(() => {
    if (form) return form
    return settings ?? ({} as Partial<Settings>)
  }, [form, settings])

  const jobInstanceId = mergedForm.job_instance_id ?? ""
  const jobModel = mergedForm.job_model ?? ""

  useEffect(() => {
    if (!jobInstanceId) return
    const inst = instances.find((i) => i.id === jobInstanceId)
    if (inst) void loadModels(inst.catalog_id)
  }, [jobInstanceId, instances, loadModels])

  const fallbackInstance = instances.find(
    (i) => i.id === (settings?.last_instance_id ?? ""),
  )
  const usingConversationModel = !jobInstanceId && !jobModel

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setSaved(false)
    try {
      await saveSettings(mergedForm)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch {
      // error handled by context
    } finally {
      setSaving(false)
    }
  }

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    setForm((prev) => ({ ...(prev ?? settings ?? {}), [key]: value }))

  const handleJobInstanceChange = (instanceId: string) => {
    setForm((prev) => ({
      ...(prev ?? settings ?? {}),
      job_instance_id: instanceId,
      job_model: "",
    }))
  }

  const handleClearJobLLM = () => {
    setForm((prev) => ({
      ...(prev ?? settings ?? {}),
      job_instance_id: "",
      job_model: "",
    }))
  }

  // --- Add form ---
  const handleStartAdd = () => {
    setEditForm({ mode: false })
    setAddForm({
      mode: "add",
      catalog_id: providers[0]?.id ?? "",
      name: providers[0]?.name ?? "",
      api_key: "",
      base_url: "",
      saving: false,
      error: "",
    })
  }

  const handleAddCatalogChange = (catalogId: string) => {
    const p = providers.find((pr) => pr.id === catalogId)
    setAddForm((prev) =>
      prev.mode === "add"
        ? { ...prev, catalog_id: catalogId, name: p?.name ?? catalogId }
        : prev,
    )
  }

  const handleAddSubmit = async () => {
    if (addForm.mode !== "add") return
    if (!addForm.catalog_id || !addForm.name.trim()) return
    setAddForm((prev) => (prev.mode === "add" ? { ...prev, saving: true, error: "" } : prev))
    const result = await createInstance({
      name: addForm.name.trim(),
      catalog_id: addForm.catalog_id,
      api_key: addForm.api_key,
      base_url: addForm.base_url || undefined,
    })
    if (result) {
      setAddForm({ mode: false })
    } else {
      setAddForm((prev) => (prev.mode === "add" ? { ...prev, saving: false, error: "添加失败" } : prev))
    }
  }

  // --- Edit form ---
  const handleStartEdit = (inst: typeof instances[0]) => {
    setAddForm({ mode: false })
    setEditForm({
      mode: "edit",
      id: inst.id,
      name: inst.name,
      catalog_id: inst.catalog_id,
      original_catalog_id: inst.catalog_id,
      api_key: "",
      base_url: inst.base_url,
      saving: false,
      error: "",
    })
  }

  const handleEditSubmit = async () => {
    if (editForm.mode !== "edit") return
    setEditForm((prev) => (prev.mode === "edit" ? { ...prev, saving: true, error: "" } : prev))
    const result = await updateInstance(editForm.id, {
      name: editForm.name.trim(),
      catalog_id: editForm.catalog_id,
      api_key: editForm.api_key || undefined,
      base_url: editForm.base_url || undefined,
    })
    if (result) {
      setEditForm({ mode: false })
    } else {
      setEditForm((prev) => (prev.mode === "edit" ? { ...prev, saving: false, error: "保存失败" } : prev))
    }
  }

  // --- Delete ---
  const handleDelete = async () => {
    if (!deleteConfirm) return
    const ok = await deleteInstance(deleteConfirm.id)
    if (ok) setDeleteConfirm(null)
  }

  return (
    <PageContainer className="[-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <h1 className="mb-6 text-xl font-semibold">Settings</h1>
      <form
        onSubmit={handleSubmit}
        className="space-y-6 [&_[data-slot=card]]:overflow-visible"
      >
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Providers</CardTitle>
                <CardDescription>
                  管理已添加的 Provider 实例
                </CardDescription>
              </div>
              <Button
                size="sm"
                onClick={handleStartAdd}
                disabled={addForm.mode !== false || editForm.mode !== false}
              >
                <Plus className="size-3.5 mr-1" />
                添加
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* Instance list */}
            {instances.length === 0 && addForm.mode === false && editForm.mode === false && (
              <p className="text-sm text-muted-foreground text-center py-4">
                还没有添加任何 Provider，点击上方「添加」开始
              </p>
            )}
            {instances.map((inst) => {
              const catalogInfo = providers.find((p) => p.id === inst.catalog_id)
              const isEditing = editForm.mode === "edit" && editForm.id === inst.id
              return (
                <div key={inst.id} className="space-y-2 border rounded-lg p-3">
                  {isEditing ? (
                    /* Edit form */
                    <>
                      <div className="space-y-2">
                        <div>
                          <label className="text-xs font-medium text-muted-foreground">Provider 类型</label>
                          <select
                            value={editForm.catalog_id}
                            onChange={(e) => setEditForm((prev) =>
                              prev.mode === "edit" ? { ...prev, catalog_id: e.target.value } : prev,
                            )}
                            className="mt-0.5 w-full h-7 rounded-md border border-input bg-transparent px-2 text-sm"
                          >
                            {providers.map((p) => (
                              <option key={p.id} value={p.id}>{p.name}</option>
                            ))}
                          </select>
                        </div>
                        {editForm.catalog_id !== editForm.original_catalog_id && (
                          <p className="text-xs text-amber-600">
                            ⚠ 更改类型后，当前选定的模型将被重置
                          </p>
                        )}
                        <div>
                          <label className="text-xs font-medium text-muted-foreground">名称</label>
                          <Input
                            value={editForm.name}
                            onChange={(e) => setEditForm((prev) =>
                              prev.mode === "edit" ? { ...prev, name: e.target.value } : prev,
                            )}
                            className="h-7 text-sm mt-0.5"
                          />
                        </div>
                        <div>
                          <label className="text-xs font-medium text-muted-foreground">
                            API Key{inst.api_key_masked ? ` (当前: ${inst.api_key_masked})` : ""}
                          </label>
                          <Input
                            type="password"
                            placeholder="输入新 key 以更换"
                            value={editForm.api_key}
                            onChange={(e) => setEditForm((prev) =>
                              prev.mode === "edit" ? { ...prev, api_key: e.target.value } : prev,
                            )}
                            className="h-7 text-sm mt-0.5"
                          />
                        </div>
                        <div>
                          <label className="text-xs font-medium text-muted-foreground">
                            Base URL{catalogInfo?.api_base ? " (可选)" : " (必填)"}
                          </label>
                          <Input
                            value={editForm.base_url}
                            onChange={(e) => setEditForm((prev) =>
                              prev.mode === "edit" ? { ...prev, base_url: e.target.value } : prev,
                            )}
                            placeholder={catalogInfo?.api_base ?? ""}
                            className="h-7 text-sm mt-0.5"
                          />
                        </div>
                        {editForm.error && (
                          <p className="text-xs text-destructive">{editForm.error}</p>
                        )}
                        <div className="flex gap-2 justify-end">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setEditForm({ mode: false })}
                          >
                            取消
                          </Button>
                          <Button
                            size="sm"
                            disabled={editForm.saving || !editForm.name.trim()}
                            onClick={handleEditSubmit}
                          >
                            {editForm.saving ? "保存中..." : "保存"}
                          </Button>
                        </div>
                      </div>
                    </>
                  ) : (
                    /* Display row */
                    <div className="flex items-center gap-2">
                      <Key className="size-4 text-muted-foreground shrink-0" />
                      <span className="text-sm font-medium truncate">{inst.name}</span>
                      <span className="text-xs text-muted-foreground">
                        ({catalogInfo?.name ?? inst.catalog_id})
                      </span>
                      {inst.api_key_masked && (
                        <span className="text-xs text-muted-foreground">
                          {inst.api_key_masked}
                        </span>
                      )}
                      {!inst.api_key_masked && (
                        <span className="text-xs text-amber-600">未设置 Key</span>
                      )}
                      {catalogInfo?.doc_url && (
                        <a
                          href={catalogInfo.doc_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="ml-auto text-xs text-primary hover:underline inline-flex items-center gap-0.5 shrink-0"
                        >
                          Docs <ExternalLink className="size-3" />
                        </a>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="size-7 p-0 shrink-0"
                        onClick={() => handleStartEdit(inst)}
                        disabled={editForm.mode !== false || addForm.mode !== false}
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="size-7 p-0 text-destructive hover:text-destructive shrink-0"
                        onClick={() => setDeleteConfirm({ id: inst.id, name: inst.name })}
                        disabled={editForm.mode !== false || addForm.mode !== false}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  )}
                </div>
              )
            })}

            {/* Add form */}
            {addForm.mode === "add" && (
              <div className="border rounded-lg p-3 space-y-2 bg-muted/30">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">添加 Provider</span>
                  <Button size="sm" variant="ghost" className="size-6 p-0" onClick={() => setAddForm({ mode: false })}>
                    <X className="size-3.5" />
                  </Button>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Provider 类型</label>
                  <select
                    value={addForm.catalog_id}
                    onChange={(e) => handleAddCatalogChange(e.target.value)}
                    className="mt-0.5 w-full h-7 rounded-md border border-input bg-transparent px-2 text-sm"
                  >
                    <option value="">选择 Provider</option>
                    {providers.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">名称</label>
                  <Input
                    value={addForm.name}
                    onChange={(e) => setAddForm((prev) =>
                      prev.mode === "add" ? { ...prev, name: e.target.value } : prev,
                    )}
                    placeholder="自定义名称"
                    className="h-7 text-sm mt-0.5"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">API Key</label>
                  <Input
                    type="password"
                    value={addForm.api_key}
                    onChange={(e) => setAddForm((prev) =>
                      prev.mode === "add" ? { ...prev, api_key: e.target.value } : prev,
                    )}
                    placeholder="sk-..."
                    className="h-7 text-sm mt-0.5"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">
                    Base URL{(() => {
                      const catalogInfo = providers.find((p) => p.id === addForm.catalog_id)
                      return catalogInfo?.api_base ? " (可选)" : " (必填)"
                    })()}
                  </label>
                  <Input
                    value={addForm.base_url}
                    onChange={(e) => setAddForm((prev) =>
                      prev.mode === "add" ? { ...prev, base_url: e.target.value } : prev,
                    )}
                    placeholder={
                      providers.find((p) => p.id === addForm.catalog_id)?.api_base || "https://..."
                    }
                    className="h-7 text-sm mt-0.5"
                  />
                </div>
                {addForm.error && (
                  <p className="text-xs text-destructive">{addForm.error}</p>
                )}
                <div className="flex gap-2 justify-end">
                  <Button size="sm" variant="outline" onClick={() => setAddForm({ mode: false })}>
                    取消
                  </Button>
                  <Button
                    size="sm"
                    disabled={addForm.saving || !addForm.catalog_id || !addForm.name.trim()}
                    onClick={handleAddSubmit}
                  >
                    {addForm.saving ? "添加中..." : "添加"}
                  </Button>
                </div>
              </div>
            )}

            {/* Delete confirm */}
            {deleteConfirm && (
              <div className="border rounded-lg p-3 space-y-2 bg-destructive/5">
                <p className="text-sm">
                  确认删除「{deleteConfirm.name}」？此操作不可撤销。
                </p>
                <div className="flex gap-2 justify-end">
                  <Button size="sm" variant="outline" onClick={() => setDeleteConfirm(null)}>
                    取消
                  </Button>
                  <Button size="sm" variant="destructive" onClick={handleDelete}>
                    删除
                  </Button>
                </div>
              </div>
            )}

            {providers.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Loading providers...
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Jobs</CardTitle>
            <CardDescription>
              摄入任务（文件上传、文本处理等）使用的 Provider 和 Model。
              未设置时将使用对话中最近使用的 Provider 和 Model。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {instances.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                请先在上方添加 Provider 实例
              </p>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium">Provider 实例</label>
                    <select
                      value={jobInstanceId}
                      onChange={(e) => handleJobInstanceChange(e.target.value)}
                      className="mt-1 w-full h-9 rounded-md border border-input bg-transparent px-2 text-sm"
                    >
                      <option value="">使用对话模型</option>
                      {instances.map((inst) => (
                        <option key={inst.id} value={inst.id}>
                          {inst.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-sm font-medium">Model</label>
                    <select
                      value={jobModel}
                      onChange={(e) => set("job_model", e.target.value)}
                      disabled={!jobInstanceId || currentModels.length === 0}
                      className="mt-1 w-full h-9 rounded-md border border-input bg-transparent px-2 text-sm disabled:opacity-50"
                    >
                      <option value="">选择模型</option>
                      {currentModels.map((m) => (
                        <option key={m.model_id} value={m.model_id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                {jobInstanceId && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={handleClearJobLLM}
                  >
                    使用对话模型
                  </Button>
                )}
                {usingConversationModel && (
                  <p className="text-xs text-muted-foreground">
                    当前回退：
                    {fallbackInstance && settings?.last_model
                      ? ` ${fallbackInstance.name} / ${settings.last_model}`
                      : settings?.last_instance_id || settings?.last_model
                        ? ` ${settings.last_instance_id}${settings.last_model ? ` / ${settings.last_model}` : ""}`
                        : " 尚未在对话中选择 Provider 和 Model"}
                  </p>
                )}
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Processing</CardTitle>
            <CardDescription>
              Chunk size, overlap, and indexing behavior.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium">Max Tokens</label>
                <Input
                  type="number"
                  value={mergedForm.max_tokens || ""}
                  onChange={(e) =>
                    set("max_tokens", parseInt(e.target.value) || 0)
                  }
                  className="mt-1"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Temperature</label>
                <Input
                  type="number"
                  step="0.1"
                  value={mergedForm.temperature || ""}
                  onChange={(e) =>
                    set("temperature", parseFloat(e.target.value) || 0)
                  }
                  className="mt-1"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium">Chunk Size</label>
                <Input
                  type="number"
                  value={mergedForm.chunk_size || ""}
                  onChange={(e) =>
                    set("chunk_size", parseInt(e.target.value) || 0)
                  }
                  className="mt-1"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Chunk Overlap</label>
                <Input
                  type="number"
                  value={mergedForm.chunk_overlap || ""}
                  onChange={(e) =>
                    set("chunk_overlap", parseInt(e.target.value) || 0)
                  }
                  className="mt-1"
                />
              </div>
            </div>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={mergedForm.auto_reindex ?? true}
                  onChange={(e) => set("auto_reindex", e.target.checked)}
                  className="rounded"
                />
                Auto Reindex
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={mergedForm.watch_sources ?? true}
                  onChange={(e) => set("watch_sources", e.target.checked)}
                  className="rounded"
                />
                Watch Sources
              </label>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <GitBranch className="size-4" />
              Version Control
            </CardTitle>
            <CardDescription>
              管理 wiki 版本历史、查看变更差异和回滚操作
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!vcStatus?.enabled ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <ShieldOff className="size-4" />
                  <span>Not Enabled</span>
                </div>
                <Button
                  size="sm"
                  onClick={handleVCInit}
                  disabled={vcLoading || !vcStatus?.git_available}
                >
                  {vcLoading ? "Initializing..." : "Enable Version Control"}
                </Button>
                {vcStatus && !vcStatus.git_available && (
                  <p className="text-xs text-amber-600">
                    Git is not installed. Please install git to enable version control.
                  </p>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm">
                  <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                    Active
                  </span>
                  <span className="text-muted-foreground">
                    {vcStatus.commit_count} commit{vcStatus.commit_count !== 1 ? "s" : ""}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground space-y-1">
                  <div>Tracked: <code className="bg-muted px-1 rounded">{vcStatus.tracked_dirs.join(", ")}</code></div>
                  <div>Excluded: <code className="bg-muted px-1 rounded">{vcStatus.excluded_dirs.join(", ")}</code></div>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => navigateTo(workbenchViewHref("timeline"))}
                  >
                    <History className="size-3.5 mr-1" />
                    View History
                  </Button>
                  {!vcDisableConfirm ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setVCDisableConfirm(true)}
                    >
                      Disable
                    </Button>
                  ) : (
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-muted-foreground">
                        禁用将保留 .git 目录但停止自动提交
                      </span>
                      <Button size="sm" variant="destructive" onClick={handleVCDisable} disabled={vcLoading}>
                        {vcLoading ? "Disabling..." : "Confirm Disable"}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setVCDisableConfirm(false)}>
                        Cancel
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={saving}>
            {saving ? "Saving..." : "Save Settings"}
          </Button>
          {saved && (
            <span className="text-sm text-green-600">Settings saved</span>
          )}
        </div>
      </form>
    </PageContainer>
  )
}
