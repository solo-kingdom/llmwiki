import * as React from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { PlusIcon, Trash2Icon } from "lucide-react"
import { useConfirm } from "@/components/blocks/confirm"
import { notify } from "@/components/blocks/notify"
import { EmptyState, RowsSkeleton } from "@/components/blocks/state-boundary"
import { StatusBadge } from "@/components/blocks/status-badge"
import { Inline, Panel, Row, Rows, Section, Stack } from "@/components/blocks/surfaces"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useApp } from "@/context/app-context"
import { checkProviderInstance, createProviderInstance, deleteProviderInstance, listProviderModels, updateLastModel } from "@/lib/api"
import type { ProviderCheckResult } from "@/types"
import { SettingRow, useSettingsSave } from "./shared"

function ProviderInstances({ onSaved }: { onSaved: () => Promise<void> }) {
  const confirm = useConfirm()
  const { instances, providers } = useApp()
  const [checks, setChecks] = React.useState<Record<string, ProviderCheckResult>>({})
  const [open, setOpen] = React.useState(false)
  const [draft, setDraft] = React.useState({ name: "", catalog_id: "openai", base_url: "", api_key: "" })

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
  const create = useMutation({
    mutationFn: createProviderInstance,
    onSuccess: async () => {
      notify.success("已添加实例")
      setOpen(false)
      setDraft({ name: "", catalog_id: "openai", base_url: "", api_key: "" })
      await onSaved()
    },
    onError: (error) => notify.error(error, "添加失败"),
  })

  return (
    <Stack gap="md">
      <Panel padding="none">
        {instances.length === 0 ? (
          <EmptyState
            title="还没有 Provider 实例"
            description="添加一个实例后即可选择模型。"
            action={<Button size="sm" variant="outline" onClick={() => setOpen(true)}><PlusIcon />添加实例</Button>}
          />
        ) : null}
        <Rows label="Provider 实例">
          {instances.map((instance) => (
            <Row key={instance.id}>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{instance.name}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {instance.catalog_id} · {instance.base_url || "默认地址"} · {instance.api_key_masked || "未设置 key"}
                </div>
              </div>
              {checks[instance.id] ? (
                <StatusBadge status={checks[instance.id]?.status === "ok" ? "ok" : "error"} />
              ) : null}
              <Button size="sm" variant="outline" onClick={() => check.mutate(instance.id)} disabled={check.isPending}>
                检查
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
          ))}
        </Rows>
      </Panel>
      {instances.length > 0 ? (
        <Inline>
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}><PlusIcon />添加实例</Button>
        </Inline>
      ) : null}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>添加 Provider 实例</DialogTitle>
            <DialogDescription>选择内置 Provider，填入 API Key 与可选的自定义地址。</DialogDescription>
          </DialogHeader>
          <Stack gap="md">
            <Input placeholder="实例名称" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
            <Select value={draft.catalog_id} onValueChange={(value) => setDraft({ ...draft, catalog_id: value })}>
              <SelectTrigger aria-label="Provider 类型"><SelectValue /></SelectTrigger>
              <SelectContent>
                {providers.map((provider) => <SelectItem key={provider.id} value={provider.id}>{provider.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input placeholder="Base URL（可选）" value={draft.base_url} onChange={(event) => setDraft({ ...draft, base_url: event.target.value })} />
            <Input placeholder="API Key" type="password" value={draft.api_key} onChange={(event) => setDraft({ ...draft, api_key: event.target.value })} />
          </Stack>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
            <Button
              onClick={() => create.mutate({ name: draft.name, catalog_id: draft.catalog_id, base_url: draft.base_url, api_key: draft.api_key })}
              disabled={draft.name.trim() === "" || create.isPending}
            >
              添加
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Stack>
  )
}

export function ModelsSection() {
  const { settings, instances, refresh } = useApp()
  const save = useSettingsSave()
  const [modelInstanceId, setModelInstanceId] = React.useState("")

  const setLastModel = useMutation({
    mutationFn: ({ instanceId, model }: { instanceId: string; model: string }) => updateLastModel(instanceId, model),
    onSuccess: () => void refresh(),
    onError: (error: Error) => notify.error(error, "保存失败"),
  })

  const activeInstance = instances.find((instance) => instance.id === (modelInstanceId || settings?.last_instance_id)) ?? instances[0]
  const models = useQuery({
    queryKey: ["provider-models", activeInstance?.catalog_id],
    queryFn: () => listProviderModels(activeInstance?.catalog_id ?? ""),
    enabled: activeInstance !== undefined,
  })

  if (settings === undefined) return <RowsSkeleton rows={6} />

  const selectedInstanceId = instances.some((instance) => instance.id === (modelInstanceId || settings.last_instance_id))
    ? (modelInstanceId || settings.last_instance_id)
    : ""
  const selectedModel = (models.data ?? []).some((model) => model.model_id === settings.last_model) ? settings.last_model : ""

  return (
    <>
      <Section size="lg" gap="lg" title="Provider 实例" description="对话与摄入使用的模型来源。">
        <ProviderInstances onSaved={refresh} />
      </Section>

      <Section size="lg" gap="lg" title="默认模型" description="未在会话中指定时使用。">
        <Panel padding="none">
          <Rows label="默认模型">
            <SettingRow
              label="Provider 实例"
              description="新建会话默认使用的实例"
              control={
                <Select
                  value={selectedInstanceId}
                  onValueChange={(value) => {
                    setModelInstanceId(value)
                    save.mutate({ last_instance_id: value })
                  }}
                >
                  <SelectTrigger aria-label="默认 Provider 实例" className="w-52 max-sm:w-full"><SelectValue placeholder="选择实例" /></SelectTrigger>
                  <SelectContent>
                    {instances.map((instance) => <SelectItem key={instance.id} value={instance.id}>{instance.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              }
            />
            <SettingRow
              label="默认模型"
              description="可在对话中临时切换"
              control={
                <Select
                  value={selectedModel}
                  onValueChange={(value) => setLastModel.mutate({ instanceId: settings.last_instance_id, model: value })}
                >
                  <SelectTrigger aria-label="默认模型" className="w-52 max-sm:w-full"><SelectValue placeholder="选择模型" /></SelectTrigger>
                  <SelectContent>
                    {(models.data ?? []).map((model) => <SelectItem key={model.model_id} value={model.model_id}>{model.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              }
            />
            <SettingRow
              label="摄入任务模型"
              description="后台整理任务使用的模型；留空沿用默认"
              control={<Input aria-label="摄入任务模型" className="w-52 max-sm:w-full" defaultValue={settings.job_model} onBlur={(event) => save.mutate({ job_model: event.target.value })} />}
            />
          </Rows>
        </Panel>
      </Section>
    </>
  )
}
