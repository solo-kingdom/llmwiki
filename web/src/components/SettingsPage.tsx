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
import type { Settings, VCStatus, ProviderCheckResult, MCPServerCheckResult } from "@/types"
import { PageContainer } from "@/components/PageContainer"
import { Key, Plus, Pencil, Trash2, X, ExternalLink, GitBranch, History, ShieldOff, CheckCircle2, XCircle, Loader2, CircleOff, RefreshCw } from "lucide-react"
import { initVC, getVCStatus, disableVC, checkProviderInstance, checkAllProviderInstances, checkMCPStatus } from "@/lib/api"
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
  const [mcpJsonError, setMcpJsonError] = useState<string | null>(null)
  const [providerChecks, setProviderChecks] = useState<Record<string, ProviderCheckResult>>({})
  const [providerChecking, setProviderChecking] = useState(false)
  const [mcpChecks, setMcpChecks] = useState<MCPServerCheckResult[] | null>(null)
  const [mcpChecking, setMcpChecking] = useState(false)

  useEffect(() => {
    void loadSettings()
    void loadProviders()
    void loadInstances()
    void loadVCStatus()
  }, [loadSettings, loadProviders, loadInstances])

  useEffect(() => {
    if (instances.length === 0) return
    void runProviderChecks()
  }, [instances.length])

  const loadVCStatus = async () => {
    try {
      const status = await getVCStatus()
      setVCStatus(status)
    } catch {
      // ignore
    }
  }

  const runProviderChecks = async () => {
    if (instances.length === 0) return
    setProviderChecking(true)
    try {
      const resp = await checkAllProviderInstances()
      const next: Record<string, ProviderCheckResult> = {}
      for (const item of resp.instances) {
        next[item.instance_id] = item.check
      }
      setProviderChecks(next)
    } catch {
      // ignore
    } finally {
      setProviderChecking(false)
    }
  }

  const runSingleProviderCheck = async (instanceId: string) => {
    setProviderChecking(true)
    try {
      const result = await checkProviderInstance(instanceId)
      setProviderChecks((prev) => ({ ...prev, [instanceId]: result }))
    } catch {
      // ignore
    } finally {
      setProviderChecking(false)
    }
  }

  const runMCPCheck = async () => {
    const raw = mergedForm.mcp_servers_json ?? settings?.mcp_servers_json ?? ""
    const err = validateMCPJson(raw)
    if (err) {
      setMcpJsonError(err)
      return
    }
    setMcpChecking(true)
    setMcpChecks(null)
    try {
      const resp = await checkMCPStatus(raw)
      setMcpChecks(resp.servers)
    } catch {
      setMcpChecks([])
    } finally {
      setMcpChecking(false)
    }
  }

  const renderProviderStatus = (instanceId: string) => {
    const check = providerChecks[instanceId]
    if (providerChecking && !check) {
      return (
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <Loader2 className="size-3 animate-spin" />
          检查中
        </span>
      )
    }
    if (!check) return null
    const ok = check.status === "ok"
    return (
      <span
        className={`inline-flex items-center gap-1 text-xs ${ok ? "text-green-700" : "text-destructive"}`}
        title={check.message}
        data-testid={`provider-check-${instanceId}`}
      >
        {ok ? <CheckCircle2 className="size-3" /> : <XCircle className="size-3" />}
        {ok ? "正常" : "异常"}
      </span>
    )
  }

  const renderMCPStatusBadge = (srv: MCPServerCheckResult) => {
    const ok = srv.status === "ok"
    const disabled = srv.status === "disabled"
    return (
      <div
        key={srv.id}
        className="flex items-start gap-2 rounded-md border px-3 py-2 text-sm"
        data-testid={`mcp-check-${srv.id}`}
      >
        {ok ? (
          <CheckCircle2 className="size-4 text-green-700 shrink-0 mt-0.5" />
        ) : disabled ? (
          <CircleOff className="size-4 text-muted-foreground shrink-0 mt-0.5" />
        ) : (
          <XCircle className="size-4 text-destructive shrink-0 mt-0.5" />
        )}
        <div className="min-w-0">
          <div className="font-medium truncate">{srv.name || srv.id}</div>
          <div className="text-xs text-muted-foreground">{srv.message}</div>
        </div>
      </div>
    )
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

  const validateMCPJson = (raw: string): string | null => {
    const trimmed = raw.trim()
    if (!trimmed) return null
    try {
      const parsed = JSON.parse(trimmed) as {
        version?: number
        servers?: Record<string, Record<string, unknown>>
      }
      if (parsed.version !== 1) {
        return "version 必须为 1"
      }
      if (parsed.servers == null) {
        return "servers 为必填对象，key 为 server id"
      }
      if (Array.isArray(parsed.servers)) {
        return "servers 必须是对象（key 为 id），不能是数组"
      }
      if (typeof parsed.servers !== "object") {
        return "servers 必须是对象，key 为 server id"
      }
      for (const [key, srv] of Object.entries(parsed.servers)) {
        if (!key.trim()) {
          return "servers 的 key 不能为空"
        }
        const id = typeof srv?.id === "string" ? srv.id.trim() : ""
        if (id && id !== key) {
          return `servers.${key}.id 必须与 key "${key}" 一致`
        }
        if (!srv?.name || String(srv.name).trim() === "") {
          return `servers.${key}.name 为必填`
        }
        if (!srv?.transport || String(srv.transport).trim() === "") {
          return `servers.${key}.transport 为必填`
        }
        const transport = String(srv.transport).trim()
        if (transport !== "stdio" && (!srv?.url || String(srv.url).trim() === "")) {
          return `servers.${key}.url 为必填（transport 为 ${transport}）`
        }
      }
      return null
    } catch (err) {
      return err instanceof Error ? err.message : "JSON 格式无效"
    }
  }

  const handleMCPJsonChange = (value: string) => {
    set("mcp_servers_json", value)
    setMcpJsonError(validateMCPJson(value))
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    const mcpErr = validateMCPJson(mergedForm.mcp_servers_json ?? "")
    if (mcpErr) {
      setMcpJsonError(mcpErr)
      return
    }
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
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void runProviderChecks()}
                  disabled={providerChecking || instances.length === 0}
                  data-testid="check-all-providers"
                >
                  {providerChecking ? (
                    <Loader2 className="size-3.5 mr-1 animate-spin" />
                  ) : (
                    <RefreshCw className="size-3.5 mr-1" />
                  )}
                  检查状态
                </Button>
                <Button
                  size="sm"
                  onClick={handleStartAdd}
                  disabled={addForm.mode !== false || editForm.mode !== false}
                >
                  <Plus className="size-3.5 mr-1" />
                  添加
                </Button>
              </div>
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
                      {renderProviderStatus(inst.id)}
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
                        title="检查连接"
                        onClick={() => void runSingleProviderCheck(inst.id)}
                        disabled={providerChecking}
                      >
                        <RefreshCw className={`size-3.5 ${providerChecking ? "animate-spin" : ""}`} />
                      </Button>
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
            <div className="flex items-center justify-between gap-4">
              <div>
                <CardTitle>MCP Servers</CardTitle>
                <CardDescription>
                  全局 MCP 客户端配置（JSON 高级模式）。默认仅允许只读工具 search/read。
                </CardDescription>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void runMCPCheck()}
                disabled={mcpChecking || !!mcpJsonError}
                data-testid="check-mcp"
              >
                {mcpChecking ? (
                  <Loader2 className="size-3.5 mr-1 animate-spin" />
                ) : (
                  <RefreshCw className="size-3.5 mr-1" />
                )}
                检查连接
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            <label className="text-sm font-medium">mcp_servers_json</label>
            <textarea
              data-testid="mcp-servers-json"
              className="mt-1 w-full min-h-[200px] rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs"
              value={mergedForm.mcp_servers_json ?? settings?.mcp_servers_json ?? ""}
              onChange={(e) => handleMCPJsonChange(e.target.value)}
              spellCheck={false}
            />
            {mcpJsonError && (
              <p className="text-xs text-destructive" data-testid="mcp-json-error">
                {mcpJsonError}
              </p>
            )}
            {mcpChecks && (
              <div className="space-y-2" data-testid="mcp-check-results">
                {mcpChecks.length === 0 ? (
                  <p className="text-xs text-muted-foreground">未配置 MCP server</p>
                ) : (
                  mcpChecks.map(renderMCPStatusBadge)
                )}
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              保存后服务端会校验并返回格式化 JSON。
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Logs</CardTitle>
            <CardDescription>
              系统活动日志最大保留条数（100–100000，默认 10000）。超出后自动删除最旧记录。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <label className="text-sm font-medium">最大保留条数</label>
            <Input
              type="number"
              min={100}
              max={100000}
              value={
                mergedForm.activity_logs_max_count ??
                (typeof settings?.activity_logs_max_count === "number"
                  ? settings.activity_logs_max_count
                  : 10000)
              }
              onChange={(e) =>
                set(
                  "activity_logs_max_count",
                  parseInt(e.target.value, 10) || 10000,
                )
              }
              className="mt-1 max-w-xs"
            />
            <label className="text-sm font-medium mt-4 block">
              每个 Job 执行日志保留条数
            </label>
            <p className="text-xs text-muted-foreground mb-1">
              50–2000，默认 200。超出后按 job 删除最旧事件。
            </p>
            <Input
              type="number"
              min={50}
              max={2000}
              value={
                mergedForm.ingest_job_events_max_count ??
                (typeof settings?.ingest_job_events_max_count === "number"
                  ? settings.ingest_job_events_max_count
                  : 200)
              }
              onChange={(e) =>
                set(
                  "ingest_job_events_max_count",
                  parseInt(e.target.value, 10) || 200,
                )
              }
              className="mt-1 max-w-xs"
            />
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
