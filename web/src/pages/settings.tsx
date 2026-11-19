import * as React from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { PlusIcon, Trash2Icon } from "lucide-react"
import { Grid, Page, Panel, Row, Rows, Section, Stack, Inline } from "@/components/blocks/surfaces"
import { StatusBadge } from "@/components/blocks/status-badge"
import { RowsSkeleton, ErrorState, EmptyState } from "@/components/blocks/state-boundary"
import { useConfirm } from "@/components/blocks/confirm"
import { notify } from "@/components/blocks/notify"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useApp } from "@/context/app-context"
import {
  checkACPAgents,
  checkMCPStatus,
  checkProviderInstance,
  createProviderInstance,
  deleteProviderInstance,
  getWorkspaceRuleFiles,
  listProviderModels,
  updateLastModel,
  updateSettings,
  updateWorkspaceRuleFiles,
} from "@/lib/api"
import type { ACPAgentCheckResult, ProviderCheckResult, Settings } from "@/types"

function SettingRow({ label, description, control }: { label: string; description?: string | undefined; control: React.ReactNode }) {
  return (
    <Row>
      <div className="min-w-0 flex-1">
        <Grid columns={2}>
          <div className="min-w-0">
            <div className="text-sm font-medium">{label}</div>
            {description !== undefined ? <div className="text-xs text-muted-foreground">{description}</div> : null}
          </div>
          <div className="min-w-0 max-sm:w-full">{control}</div>
        </Grid>
      </div>
    </Row>
  )
}

function NumberSetting({ label, description, value, defaultValue, onSave, step = "1" }: {
  label: string
  description?: string
  value: number | undefined
  defaultValue: number
  onSave: (value: number) => void
  step?: string
}) {
  const [draft, setDraft] = React.useState<string | null>(null)
  const display = draft ?? (value === undefined ? "" : String(value))
  return (
    <SettingRow
      label={label}
      description={description}
      control={
        <Input
          className="w-32 max-sm:w-full"
          type="number"
          step={step}
          aria-label={label}
          placeholder={String(defaultValue)}
          value={display}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => {
            const parsed = Number(display)
            if (display !== "" && Number.isFinite(parsed) && parsed !== value) onSave(parsed)
            setDraft(null)
          }}
        />
      }
    />
  )
}

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
              <SelectTrigger><SelectValue /></SelectTrigger>
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

function JsonDialog({ title, description, value, onChange, onSave, onCheck, checkResult }: {
  title: string
  description: string
  value: string
  onChange: (value: string) => void
  onSave: () => void
  onCheck: () => void
  checkResult: React.ReactNode
}) {
  const [open, setOpen] = React.useState(false)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>编辑</Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <Stack gap="md">
          <Textarea className="min-h-48 font-mono text-xs" value={value} onChange={(event) => onChange(event.target.value)} />
          {checkResult}
        </Stack>
        <DialogFooter>
          <Button variant="outline" onClick={onCheck}>检查</Button>
          <Button onClick={() => { onSave(); setOpen(false) }}>保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RuleFiles() {
  const ruleFiles = useQuery({ queryKey: ["rule-files"], queryFn: getWorkspaceRuleFiles })
  const [draft, setDraft] = React.useState<{ purpose: string; rules: string } | null>(null)
  const [open, setOpen] = React.useState(false)
  const purpose = draft?.purpose ?? ruleFiles.data?.purpose_preview ?? ""
  const rules = draft?.rules ?? ruleFiles.data?.rules_preview ?? ""

  const save = useMutation({
    mutationFn: () => updateWorkspaceRuleFiles({
      ...(purpose.trim() !== "" ? { purpose } : {}),
      ...(rules.trim() !== "" ? { rules } : {}),
    }),
    onSuccess: async () => {
      notify.success("规则文件已保存")
      setOpen(false)
      setDraft(null)
      await ruleFiles.refetch()
    },
    onError: (error) => notify.error(error, "保存失败"),
  })

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>编辑规则文件</Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>工作区规则文件</DialogTitle>
          <DialogDescription>purpose.md 与 rules.md 会参与摄入和整理提示词。</DialogDescription>
        </DialogHeader>
        {ruleFiles.isError ? <ErrorState error={ruleFiles.error} onRetry={() => void ruleFiles.refetch()} /> : null}
        {ruleFiles.isLoading ? <RowsSkeleton rows={3} /> : null}
        <Stack gap="md">
          <div className="text-sm font-medium">purpose.md</div>
          <Textarea className="min-h-32 font-mono text-xs" value={purpose} onChange={(event) => setDraft({ purpose: event.target.value, rules })} />
          <div className="text-sm font-medium">rules.md</div>
          <Textarea className="min-h-32 font-mono text-xs" value={rules} onChange={(event) => setDraft({ purpose, rules: event.target.value })} />
        </Stack>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function SettingsRoute() {
  const { settings, instances, acpAgents, isLoading, error, refresh } = useApp()
  const [modelInstanceId, setModelInstanceId] = React.useState("")
  const [acpDraft, setAcpDraft] = React.useState<string | null>(null)
  const [mcpDraft, setMcpDraft] = React.useState<string | null>(null)
  const [acpChecks, setAcpChecks] = React.useState<ACPAgentCheckResult[]>([])
  const [mcpChecks, setMcpChecks] = React.useState<{ id: string; name: string; status: string; message?: string }[]>([])
  const [token, setToken] = React.useState("")
  const acpJson = acpDraft ?? settings?.acp_agents_json ?? ""
  const mcpJson = mcpDraft ?? settings?.mcp_servers_json ?? ""

  const save = useMutation({
    mutationFn: (patch: Partial<Settings>) => updateSettings(patch),
    onSuccess: async () => {
      notify.success("已保存")
      await refresh()
    },
    onError: (error) => notify.error(error, "保存失败"),
  })

  const setLastModel = useMutation({
    mutationFn: ({ instanceId, model }: { instanceId: string; model: string }) => updateLastModel(instanceId, model),
    onSuccess: () => void refresh(),
    onError: (error) => notify.error(error, "保存失败"),
  })

  const activeInstance = instances.find((instance) => instance.id === (modelInstanceId || settings?.last_instance_id)) ?? instances[0]
  const models = useQuery({
    queryKey: ["provider-models", activeInstance?.catalog_id],
    queryFn: () => listProviderModels(activeInstance?.catalog_id ?? ""),
    enabled: activeInstance !== undefined,
  })

  if (isLoading) return <RowsSkeleton rows={10} />
  if (error) return <ErrorState error={error} onRetry={() => void refresh()} />
  if (!settings) return <RowsSkeleton rows={10} />

  return (
    <Page title="设置">
      <Section title="Provider 实例" description="对话与摄入使用的模型来源。">
        <ProviderInstances onSaved={refresh} />
      </Section>

      <Section title="默认模型" description="未在会话中指定时使用。">
        <Panel padding="none">
          <Rows label="默认模型">
            <SettingRow
              label="Provider 实例"
              description="新建会话默认使用的实例"
              control={
                <Select
                  value={modelInstanceId || settings.last_instance_id}
                  onValueChange={(value) => {
                    setModelInstanceId(value)
                    save.mutate({ last_instance_id: value })
                  }}
                >
                  <SelectTrigger className="w-52 max-sm:w-full"><SelectValue placeholder="选择实例" /></SelectTrigger>
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
                  value={settings.last_model}
                  onValueChange={(value) => setLastModel.mutate({ instanceId: settings.last_instance_id, model: value })}
                >
                  <SelectTrigger className="w-52 max-sm:w-full"><SelectValue placeholder="选择模型" /></SelectTrigger>
                  <SelectContent>
                    {(models.data ?? []).map((model) => <SelectItem key={model.model_id} value={model.model_id}>{model.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              }
            />
            <SettingRow
              label="摄入任务模型"
              description="后台整理任务使用的模型；留空沿用默认"
              control={<Input className="w-52 max-sm:w-full" defaultValue={settings.job_model} onBlur={(event) => save.mutate({ job_model: event.target.value })} />}
            />
          </Rows>
        </Panel>
      </Section>

      <Section title="摄入与检索">
        <Panel padding="none">
          <Rows label="摄入设置">
            <NumberSetting label="最大 token" value={settings.max_tokens} defaultValue={4096} onSave={(value) => save.mutate({ max_tokens: value })} />
            <NumberSetting label="温度" step="0.1" value={settings.temperature} defaultValue={0.7} onSave={(value) => save.mutate({ temperature: value })} />
            <NumberSetting label="Chunk 大小" value={settings.chunk_size} defaultValue={512} onSave={(value) => save.mutate({ chunk_size: value })} />
            <NumberSetting label="Chunk 重叠" value={settings.chunk_overlap} defaultValue={128} onSave={(value) => save.mutate({ chunk_overlap: value })} />
            <SettingRow
              label="自动重建索引"
              description="内容变化后刷新派生索引"
              control={<Switch checked={settings.auto_reindex} onCheckedChange={(value) => save.mutate({ auto_reindex: value })} />}
            />
            <SettingRow
              label="监控来源目录"
              description="发现新文件时自动创建摄入任务"
              control={<Switch checked={settings.watch_sources} onCheckedChange={(value) => save.mutate({ watch_sources: value })} />}
            />
            <SettingRow
              label="Embedding 实例"
              description="用于 chunk 向量化"
              control={<Input className="w-52 max-sm:w-full" defaultValue={settings.embedding_instance_id ?? ""} onBlur={(event) => save.mutate({ embedding_instance_id: event.target.value })} />}
            />
            <SettingRow
              label="Embedding 模型"
              control={<Input className="w-52 max-sm:w-full" defaultValue={settings.embedding_model ?? ""} onBlur={(event) => save.mutate({ embedding_model: event.target.value })} />}
            />
          </Rows>
        </Panel>
      </Section>

      <Section title="访问与集成">
        <Panel padding="none">
          <Rows label="访问设置">
            <SettingRow
              label="界面语言"
              control={
                <Select value={settings.ui_language} onValueChange={(value) => save.mutate({ ui_language: value })}>
                  <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="zh">简体中文</SelectItem>
                    <SelectItem value="en">English</SelectItem>
                  </SelectContent>
                </Select>
              }
            />
            <SettingRow
              label="文档语言"
              description="生成 wiki 页面使用的主语言"
              control={
                <Select value={settings.doc_language} onValueChange={(value) => save.mutate({ doc_language: value })}>
                  <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="zh">简体中文</SelectItem>
                    <SelectItem value="en">English</SelectItem>
                  </SelectContent>
                </Select>
              }
            />
            <SettingRow
              label="API Token"
              description={settings.api_token_set ? `当前：${settings.api_token_masked}（${settings.api_token_source}）` : "当前未设置"}
              control={
                <Inline>
                  <Input className="w-44 max-sm:w-full" type="password" placeholder="留空不修改" value={token} onChange={(event) => setToken(event.target.value)} />
                  <Button size="sm" variant="outline" onClick={() => { save.mutate({ api_token: token }); setToken("") }}>保存</Button>
                </Inline>
              }
            />
            <SettingRow
              label="默认 Agent"
              control={
                <Select value={settings.default_agent_kind ?? "native"} onValueChange={(value) => save.mutate({ default_agent_kind: value as "native" | "acp" })}>
                  <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="native">Native</SelectItem>
                    <SelectItem value="acp">ACP</SelectItem>
                  </SelectContent>
                </Select>
              }
            />
            <SettingRow
              label="默认 ACP Agent"
              description={`${acpAgents.filter((agent) => agent.enabled).length} 个已启用`}
              control={
                <Select value={settings.default_acp_agent_id ?? ""} onValueChange={(value) => save.mutate({ default_acp_agent_id: value })}>
                  <SelectTrigger className="w-44 max-sm:w-full"><SelectValue placeholder="未选择" /></SelectTrigger>
                  <SelectContent>
                    {acpAgents.map((agent) => <SelectItem key={agent.id} value={agent.id}>{agent.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              }
            />
          </Rows>
        </Panel>
      </Section>

      <Section title="MCP 配置" description="为摄入任务提供外部工具。">
        <Panel padding="none">
          <Rows label="MCP 配置">
            <SettingRow
              label="MCP servers JSON"
              description={mcpChecks.length > 0 ? `${mcpChecks.length} 个 server 已检查` : "未检查"}
              control={
                <JsonDialog
                  title="MCP servers JSON"
                  description="保存后对新会话生效。"
                  value={mcpJson}
                  onChange={setMcpDraft}
                  onSave={() => { save.mutate({ mcp_servers_json: mcpJson }); setMcpDraft(null) }}
                  onCheck={() => void checkMCPStatus(mcpJson).then((result) => setMcpChecks(result.servers)).catch((error) => notify.error(error, "MCP 检查失败"))}
                  checkResult={
                    mcpChecks.length === 0 ? null : (
                      <Stack gap="sm">
                        {mcpChecks.map((server) => (
                          <Row key={server.id}>
                            <span className="min-w-0 flex-1 truncate text-sm">{server.name || server.id}</span>
                            <StatusBadge status={server.status} />
                          </Row>
                        ))}
                      </Stack>
                    )
                  }
                />
              }
            />
          </Rows>
        </Panel>
      </Section>

      <Section title="ACP Agent" description="外部 coding agent，经 stdio JSON-RPC 接入。">
        <Panel padding="none">
          <Rows label="ACP Agent">
            <SettingRow
              label="ACP agents JSON"
              description={`${acpAgents.length} 个已配置`}
              control={
                <JsonDialog
                  title="ACP agents JSON"
                  description="保存后新会话生效；检查会探测命令与协议版本。"
                  value={acpJson}
                  onChange={setAcpDraft}
                  onSave={() => { save.mutate({ acp_agents_json: acpJson }); setAcpDraft(null) }}
                  onCheck={() => void checkACPAgents(acpJson).then((result) => setAcpChecks(result.agents)).catch((error) => notify.error(error, "ACP 检查失败"))}
                  checkResult={
                    acpChecks.length === 0 ? null : (
                      <Stack gap="sm">
                        {acpChecks.map((agent) => (
                          <Row key={agent.id}>
                            <span className="min-w-0 flex-1 truncate text-sm">{agent.name || agent.id}</span>
                            <StatusBadge status={agent.status} />
                          </Row>
                        ))}
                      </Stack>
                    )
                  }
                />
              }
            />
          </Rows>
        </Panel>
      </Section>

      <Section title="规则文件" description="purpose.md 与 rules.md 参与摄入与整理提示词。">
        <RuleFiles />
      </Section>
    </Page>
  )
}
