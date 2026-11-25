import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { CopyIcon, ExternalLinkIcon, PlusIcon, Trash2Icon } from "lucide-react"
import { useConfirm } from "@/components/blocks/confirm"
import { notify } from "@/components/blocks/notify"
import { EmptyState, RowsSkeleton } from "@/components/blocks/state-boundary"
import { Inline, Panel, Row, Rows, Section, Stack } from "@/components/blocks/surfaces"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { useApp } from "@/context/app-context"
import { createApiKey, deleteApiKey, listApiKeys } from "@/lib/api"
import { agentHandoffText, apiKeyCurlExample } from "@/lib/apikeys"
import type { CreatedApiKey } from "@/types"
import { SettingRow, useSettingsSave } from "./shared"

async function copyText(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text)
    notify.success(`已复制${label}`)
  } catch (error) {
    notify.error(error, `复制${label}失败`)
  }
}

function AgentApiKeysSection() {
  const confirm = useConfirm()
  const queryClient = useQueryClient()
  const [createOpen, setCreateOpen] = React.useState(false)
  const [name, setName] = React.useState("")
  const [created, setCreated] = React.useState<CreatedApiKey | null>(null)

  const apiBase = typeof window !== "undefined" ? window.location.origin : "http://127.0.0.1:8080"

  const keysQuery = useQuery({
    queryKey: ["api-keys"],
    queryFn: listApiKeys,
  })

  const create = useMutation({
    mutationFn: (keyName: string) => createApiKey(keyName),
    onSuccess: async (result) => {
      setCreated(result)
      setName("")
      await queryClient.invalidateQueries({ queryKey: ["api-keys"] })
    },
    onError: (error: Error) => notify.error(error, "创建 API Key 失败"),
  })

  const remove = useMutation({
    mutationFn: (id: string) => deleteApiKey(id),
    onSuccess: async () => {
      notify.success("已吊销 API Key")
      await queryClient.invalidateQueries({ queryKey: ["api-keys"] })
    },
    onError: (error: Error) => notify.error(error, "吊销 API Key 失败"),
  })

  const keys = keysQuery.data ?? []

  function handleDialogChange(nextOpen: boolean) {
    setCreateOpen(nextOpen)
    if (!nextOpen) {
      setCreated(null)
      setName("")
    }
  }

  return (
    <Section
      size="lg"
      gap="lg"
      title="Agent 接入与 API Key"
      description="创建独立 API Key 供外部 Agent 经 HTTP API 管理知识库；明文仅创建时展示一次，不可用于管理凭证。"
    >
      <Stack gap="md">
        <Panel padding="none">
          {keysQuery.isLoading ? (
            <RowsSkeleton rows={3} />
          ) : keys.length === 0 ? (
            <EmptyState
              title="还没有 API Key"
              description="创建一个 API Key，并把接入话术发给你的 Agent 即可自动接入。"
              action={
                <Button size="sm" variant="outline" onClick={() => setCreateOpen(true)}>
                  <PlusIcon />创建 API Key
                </Button>
              }
            />
          ) : (
            <Rows label="API Key 列表">
              {keys.map((item) => (
                <Row key={item.id}>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{item.name}</div>
                    <div className="truncate font-mono text-xs text-muted-foreground">
                      {item.prefix}… · 创建于 {item.created_at} · {item.last_used_at ? `最近使用 ${item.last_used_at}` : "尚未使用"}
                    </div>
                  </div>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`吊销 ${item.name}`}
                    onClick={async () => {
                      const ok = await confirm({
                        title: `吊销 API Key「${item.name}」？`,
                        description: "吊销后使用该 Key 的 Agent 会立即收到 401，需要重新创建并更新配置。",
                        confirmLabel: "吊销",
                        destructive: true,
                      })
                      if (ok) remove.mutate(item.id)
                    }}
                  >
                    <Trash2Icon />
                  </Button>
                </Row>
              ))}
            </Rows>
          )}
        </Panel>

        <Inline>
          {keys.length > 0 ? (
            <Button size="sm" variant="outline" onClick={() => setCreateOpen(true)}>
              <PlusIcon />创建 API Key
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="outline"
            onClick={() => void copyText(agentHandoffText(apiBase, "llmwiki_sk_xxx"), "接入话术模板")}
          >
            <CopyIcon />复制接入话术模板
          </Button>
          <Button size="sm" variant="ghost" asChild>
            <a href={`${apiBase}/skill.md`} target="_blank" rel="noreferrer">
              <ExternalLinkIcon />查看 /skill.md
            </a>
          </Button>
        </Inline>
      </Stack>

      <Dialog open={createOpen} onOpenChange={handleDialogChange}>
        <DialogContent className={created === null ? undefined : "sm:max-w-2xl"}>
          {created === null ? (
            <>
              <DialogHeader>
                <DialogTitle>创建 API Key</DialogTitle>
                <DialogDescription>为外部 Agent 或自动化脚本分配独立凭证（最多 20 个）。</DialogDescription>
              </DialogHeader>
              <Stack gap="md">
                <Input
                  aria-label="API Key 名称"
                  placeholder="例如：个人助手 / 定时整理脚本"
                  maxLength={64}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && name.trim() && !create.isPending) {
                      create.mutate(name.trim())
                    }
                  }}
                />
              </Stack>
              <DialogFooter>
                <Button variant="outline" onClick={() => handleDialogChange(false)}>取消</Button>
                <Button
                  onClick={() => create.mutate(name.trim())}
                  disabled={name.trim() === "" || create.isPending}
                >
                  创建
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>API Key 已创建（明文仅展示一次）</DialogTitle>
                <DialogDescription>
                  请立即复制保存或直接复制下方「Agent 接入话术」发给 Agent。关闭后将无法再次查看完整明文。
                </DialogDescription>
              </DialogHeader>
              <Stack gap="md">
                <Stack gap="xs">
                  <div className="text-xs font-medium text-muted-foreground">API Key 明文</div>
                  <Stack direction="row" gap="sm" align="center">
                    <Input readOnly className="min-w-0 flex-1 font-mono text-xs" value={created.key} />
                    <Button size="sm" variant="outline" className="shrink-0" onClick={() => void copyText(created.key, " API Key")}>
                      <CopyIcon />复制
                    </Button>
                  </Stack>
                </Stack>

                <Stack gap="xs">
                  <div className="text-xs font-medium text-muted-foreground">Agent 接入话术（含完整密钥，请妥善保管）</div>
                  <Textarea
                    readOnly
                    className="min-h-40 font-mono text-xs break-words field-sizing-fixed"
                    value={agentHandoffText(apiBase, created.key)}
                  />
                </Stack>

                <Stack gap="xs">
                  <div className="text-xs font-medium text-muted-foreground">curl 验证示例</div>
                  <Textarea
                    readOnly
                    className="min-h-16 font-mono text-xs break-words field-sizing-fixed"
                    value={apiKeyCurlExample(apiBase, created.key)}
                  />
                </Stack>
              </Stack>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => void copyText(agentHandoffText(apiBase, created.key), "Agent 接入话术")}
                >
                  <CopyIcon />一键复制接入话术
                </Button>
                <Button onClick={() => handleDialogChange(false)}>完成</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </Section>
  )
}

export function AccessSection() {
  const { settings, acpAgents } = useApp()
  const save = useSettingsSave()
  const [token, setToken] = React.useState("")
  if (settings === undefined) return <RowsSkeleton rows={6} />

  return (
    <>
      <Section size="lg" gap="lg" title="访问控制" description="界面语言、API 访问与默认 Agent。">
        <Panel padding="none">
          <Rows label="访问设置">
            <SettingRow
              label="界面语言"
              control={
                <Select value={settings.ui_language} onValueChange={(value) => save.mutate({ ui_language: value })}>
                  <SelectTrigger aria-label="界面语言" className="w-40"><SelectValue /></SelectTrigger>
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
                  <SelectTrigger aria-label="文档语言" className="w-40"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="zh">简体中文</SelectItem>
                    <SelectItem value="en">English</SelectItem>
                  </SelectContent>
                </Select>
              }
            />
            <SettingRow
              label="API Token（兼容全局令牌）"
              description={settings.api_token_set ? `当前：${settings.api_token_masked}（${settings.api_token_source}）` : "当前未设置"}
              control={
                <Inline>
                  <Input aria-label="API Token" className="w-44 max-sm:w-full" type="password" placeholder="留空不修改" value={token} onChange={(event) => setToken(event.target.value)} />
                  <Button size="sm" variant="outline" onClick={() => { save.mutate({ api_token: token }); setToken("") }}>保存</Button>
                </Inline>
              }
            />
            <SettingRow
              label="默认 Agent"
              control={
                <Select value={settings.default_agent_kind ?? "native"} onValueChange={(value) => save.mutate({ default_agent_kind: value as "native" | "acp" })}>
                  <SelectTrigger aria-label="默认 Agent 类型" className="w-40"><SelectValue /></SelectTrigger>
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
                  <SelectTrigger aria-label="默认 ACP Agent" className="w-44 max-sm:w-full"><SelectValue placeholder="未选择" /></SelectTrigger>
                  <SelectContent>
                    {acpAgents.map((agent) => <SelectItem key={agent.id} value={agent.id}>{agent.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              }
            />
          </Rows>
        </Panel>
      </Section>

      <AgentApiKeysSection />
    </>
  )
}
