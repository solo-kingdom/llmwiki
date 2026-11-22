import * as React from "react"
import { RowsSkeleton } from "@/components/blocks/state-boundary"
import { Inline, Panel, Rows, Section } from "@/components/blocks/surfaces"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useApp } from "@/context/app-context"
import { SettingRow, useSettingsSave } from "./shared"

export function AccessSection() {
  const { settings, acpAgents } = useApp()
  const save = useSettingsSave()
  const [token, setToken] = React.useState("")
  if (settings === undefined) return <RowsSkeleton rows={6} />

  return (
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
            label="API Token"
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
  )
}
