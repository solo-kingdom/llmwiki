import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { CopyIcon, PencilIcon, PlusIcon, RefreshCwIcon, Trash2Icon } from "lucide-react"
import { useConfirm } from "@/components/blocks/confirm"
import { notify } from "@/components/blocks/notify"
import { EmptyState, RowsSkeleton } from "@/components/blocks/state-boundary"
import { StatusBadge } from "@/components/blocks/status-badge"
import { Inline, Panel, Row, Rows, Section, Stack } from "@/components/blocks/surfaces"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useApp } from "@/context/app-context"
import {
  checkProviderInstance,
  deleteProviderInstance,
  getProviderCatalogStatus,
  listProviderModels,
  syncProviderCatalog,
} from "@/lib/api"
import { resolveLinkedModelSelection } from "@/lib/instance-models"
import type { ProviderCheckResult, ProviderInstance } from "@/types"
import { ProviderDialog } from "./provider-dialog"
import { SettingRow, useSettingsSave } from "./shared"

const INHERIT_JOB_INSTANCE = "__inherit__"

function ProviderInstances({ onSaved }: { onSaved: () => Promise<void> }) {
  const confirm = useConfirm()
  const queryClient = useQueryClient()
  const { instances, providers } = useApp()
  const [checks, setChecks] = React.useState<Record<string, ProviderCheckResult>>({})
  const [dialogState, setDialogState] = React.useState<{
    open: boolean
    mode: "create" | "edit" | "copy"
    seed?: ProviderInstance | undefined
  }>({ open: false, mode: "create" })

  const catalogStatus = useQuery({
    queryKey: ["provider-catalog-status"],
    queryFn: getProviderCatalogStatus,
  })

  const syncCatalog = useMutation({
    mutationFn: syncProviderCatalog,
    onSuccess: async (status) => {
      notify.success(`已同步 ${status.provider_count} 个供应商 / ${status.model_count} 个模型`)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["provider-catalog-status"] }),
        queryClient.invalidateQueries({ queryKey: ["providers"] }),
        queryClient.invalidateQueries({ queryKey: ["provider-models"] }),
      ])
    },
    onError: (error) => notify.error(error, "同步 models.dev 失败"),
  })

  const check = useMutation({
    mutationFn: checkProviderInstance,
    onSuccess: (result, id) => setChecks((current) => ({ ...current, [id]: result })),
    onError: (error) => notify.error(error, "检查失败"),
  })

  const remove = useMutation({
    mutationFn: deleteProviderInstance,
    onSuccess: async () => {
      notify.success("已删除实例")
      await onSaved()
    },
    onError: (error) => notify.error(error, "删除失败"),
  })

  return (
    <Stack gap="md">
      <Panel padding="none">
        {instances.length === 0 ? (
          <EmptyState
            title="还没有 Provider 实例"
            description="添加一个实例并选择模型后，即可在默认模型与对话中使用。"
            action={
              <Button
                size="sm"
                variant="outline"
                onClick={() => setDialogState({ open: true, mode: "create" })}
              >
                <PlusIcon />
                添加实例
              </Button>
            }
          />
        ) : null}
        <Rows label="Provider 实例">
          {instances.map((instance) => {
            const models = instance.models ?? []
            const primaryModel = models[0] ?? ""
            const extraCount = Math.max(0, models.length - 1)
            return (
              <Row key={instance.id}>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{instance.name}</span>
                    {models.length === 0 ? (
                      <Badge variant="outline">未选模型</Badge>
                    ) : null}
                  </div>
                  <div
                    className="truncate text-xs text-muted-foreground"
                    title={models.length > 0 ? models.join(", ") : undefined}
                  >
                    {instance.catalog_id}
                    {instance.api_format ? ` (${instance.api_format})` : ""}
                    {primaryModel ? ` · ${primaryModel}` : ""}
                    {extraCount > 0 ? ` 另 ${extraCount} 个` : ""}
                    {` · ${instance.base_url || "默认地址"} · ${instance.api_key_masked || "未设置 key"}`}
                  </div>
                </div>
                {checks[instance.id] ? (
                  <StatusBadge status={checks[instance.id]?.status === "ok" ? "ok" : "error"} />
                ) : null}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => check.mutate(instance.id)}
                  disabled={check.isPending}
                >
                  检查
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  title={`编辑 ${instance.name}`}
                  aria-label={`编辑 ${instance.name}`}
                  onClick={() => setDialogState({ open: true, mode: "edit", seed: instance })}
                >
                  <PencilIcon />
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  title={`复制 ${instance.name}`}
                  aria-label={`复制 ${instance.name}`}
                  onClick={() => setDialogState({ open: true, mode: "copy", seed: instance })}
                >
                  <CopyIcon />
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`删除 ${instance.name}`}
                  onClick={async () => {
                    const ok = await confirm({
                      title: `删除 Provider 实例「${instance.name}」？`,
                      description: "使用该实例的会话需要重新选择模型。",
                      confirmLabel: "删除",
                      destructive: true,
                    })
                    if (ok) remove.mutate(instance.id)
                  }}
                >
                  <Trash2Icon />
                </Button>
              </Row>
            )
          })}
        </Rows>
      </Panel>

      <div className="flex flex-wrap items-center justify-between gap-2">
        {instances.length > 0 ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setDialogState({ open: true, mode: "create" })}
          >
            <PlusIcon />
            添加实例
          </Button>
        ) : (
          <span />
        )}
        <Inline gap="sm">
          <span className="text-xs text-muted-foreground">
            {catalogStatus.data
              ? `models.dev 目录：${catalogStatus.data.provider_count} 供应商 / ${catalogStatus.data.model_count} 模型` +
                (catalogStatus.data.synced_at
                  ? ""
                  : "（内置快照）")
              : "正在检查目录状态…"}
          </span>
          <Button
            size="sm"
            variant="ghost"
            disabled={syncCatalog.isPending}
            onClick={() => syncCatalog.mutate()}
          >
            <RefreshCwIcon className={syncCatalog.isPending ? "animate-spin" : ""} />
            {syncCatalog.isPending ? "同步中…" : "同步 models.dev"}
          </Button>
        </Inline>
      </div>

      <ProviderDialog
        open={dialogState.open}
        onOpenChange={(open) => setDialogState((cur) => ({ ...cur, open }))}
        mode={dialogState.mode}
        seed={dialogState.seed}
        providers={providers}
        catalogStatus={catalogStatus.data}
        onSyncCatalog={() => syncCatalog.mutate()}
        syncingCatalog={syncCatalog.isPending}
        onSaved={onSaved}
      />
    </Stack>
  )
}

function useCatalogModelNames(catalogId: string | undefined) {
  const query = useQuery({
    queryKey: ["provider-models", catalogId],
    queryFn: () => listProviderModels(catalogId ?? ""),
    enabled: Boolean(catalogId) && catalogId !== "custom",
  })
  return React.useMemo(
    () => new Map((query.data ?? []).map((m) => [m.model_id, m.name])),
    [query.data],
  )
}

export function ModelsSection() {
  const { settings, instances, refresh } = useApp()
  const save = useSettingsSave()

  const defaultInstance =
    instances.find((item) => item.id === settings?.last_instance_id) ?? undefined
  const jobInstance =
    instances.find((item) => item.id === settings?.job_instance_id) ?? undefined

  const defaultCatalogNames = useCatalogModelNames(defaultInstance?.catalog_id)
  const jobCatalogNames = useCatalogModelNames(jobInstance?.catalog_id)

  if (settings === undefined) return <RowsSkeleton rows={6} />

  const defaultModels = defaultInstance?.models ?? []
  const selectedDefaultInstanceId = defaultInstance ? defaultInstance.id : ""
  const selectedDefaultModel = defaultModels.includes(settings.last_model)
    ? settings.last_model
    : ""

  const jobModels = jobInstance?.models ?? []
  const selectedJobInstanceValue = jobInstance ? jobInstance.id : INHERIT_JOB_INSTANCE
  const selectedJobModel = jobModels.includes(settings.job_model) ? settings.job_model : ""
  const defaultSummary = defaultInstance
    ? `${defaultInstance.name}${selectedDefaultModel ? ` / ${selectedDefaultModel}` : ""}`
    : "未设置"

  return (
    <>
      <Section size="lg" gap="lg" title="Provider 实例" description="从 models.dev 或自定义端点配置，并选择要使用的模型。">
        <ProviderInstances onSaved={refresh} />
      </Section>

      <Section size="lg" gap="lg" title="默认模型" description="未在会话或任务中单独指定时使用，仅从对应实例已选模型中选取。">
        <Panel padding="none">
          <Rows label="默认模型">
            <SettingRow
              label="默认 Provider 实例"
              description="新建会话默认使用的实例"
              control={
                <Select
                  value={selectedDefaultInstanceId}
                  disabled={instances.length === 0}
                  onValueChange={(nextId) => {
                    const nextModel = resolveLinkedModelSelection(
                      instances,
                      nextId,
                      settings.last_model,
                    )
                    save.mutate({ last_instance_id: nextId, last_model: nextModel })
                  }}
                >
                  <SelectTrigger aria-label="默认 Provider 实例" className="w-56 max-sm:w-full">
                    <SelectValue placeholder="选择实例" />
                  </SelectTrigger>
                  <SelectContent>
                    {instances.map((instance) => (
                      <SelectItem key={instance.id} value={instance.id}>
                        {instance.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              }
            />
            <SettingRow
              label="默认模型"
              description={
                defaultInstance && defaultModels.length === 0
                  ? "当前实例尚未选择模型，请先编辑该实例"
                  : "可在对话中临时切换"
              }
              control={
                <Select
                  value={selectedDefaultModel}
                  disabled={!defaultInstance || defaultModels.length === 0}
                  onValueChange={(value) => {
                    if (!defaultInstance) return
                    save.mutate({ last_instance_id: defaultInstance.id, last_model: value })
                  }}
                >
                  <SelectTrigger aria-label="默认模型" className="w-56 max-sm:w-full">
                    <SelectValue placeholder={defaultInstance && defaultModels.length === 0 ? "实例未选模型" : "选择模型"} />
                  </SelectTrigger>
                  <SelectContent>
                    {defaultModels.map((modelId) => {
                      const label = defaultCatalogNames.get(modelId)
                      return (
                        <SelectItem key={modelId} value={modelId}>
                          {label && label !== modelId ? `${label} (${modelId})` : modelId}
                        </SelectItem>
                      )
                    })}
                  </SelectContent>
                </Select>
              }
            />
            <SettingRow
              label="摄入任务 Provider 实例"
              description="后台整理任务使用的实例；默认沿用上方默认实例"
              control={
                <Select
                  value={selectedJobInstanceValue}
                  disabled={instances.length === 0}
                  onValueChange={(nextValue) => {
                    if (nextValue === INHERIT_JOB_INSTANCE) {
                      save.mutate({ job_instance_id: "", job_model: "" })
                      return
                    }
                    const nextModel = resolveLinkedModelSelection(
                      instances,
                      nextValue,
                      settings.job_model,
                    )
                    save.mutate({ job_instance_id: nextValue, job_model: nextModel })
                  }}
                >
                  <SelectTrigger aria-label="摄入任务 Provider 实例" className="w-56 max-sm:w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={INHERIT_JOB_INSTANCE}>沿用默认</SelectItem>
                    {instances.map((instance) => (
                      <SelectItem key={instance.id} value={instance.id}>
                        {instance.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              }
            />
            <SettingRow
              label="摄入任务模型"
              description={
                jobInstance && jobModels.length === 0
                  ? "当前任务实例尚未选择模型，请先编辑该实例"
                  : "后台整理任务使用的模型"
              }
              control={
                <Select
                  value={selectedJobModel}
                  disabled={!jobInstance || jobModels.length === 0}
                  onValueChange={(value) => {
                    if (!jobInstance) return
                    save.mutate({ job_instance_id: jobInstance.id, job_model: value })
                  }}
                >
                  <SelectTrigger aria-label="摄入任务模型" className="w-56 max-sm:w-full">
                    <SelectValue
                      placeholder={
                        !jobInstance
                          ? `沿用默认（${defaultSummary}）`
                          : jobModels.length === 0
                            ? "实例未选模型"
                            : "选择模型"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {jobModels.map((modelId) => {
                      const label = jobCatalogNames.get(modelId)
                      return (
                        <SelectItem key={modelId} value={modelId}>
                          {label && label !== modelId ? `${label} (${modelId})` : modelId}
                        </SelectItem>
                      )
                    })}
                  </SelectContent>
                </Select>
              }
            />
          </Rows>
        </Panel>
      </Section>
    </>
  )
}
