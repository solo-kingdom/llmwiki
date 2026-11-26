import * as React from "react"
import { AppLink } from "@/components/blocks/router"
import { RowsSkeleton } from "@/components/blocks/state-boundary"
import { notify } from "@/components/blocks/notify"
import { StatusBadge } from "@/components/blocks/status-badge"
import { Panel, Row, Rows, Section, Stack } from "@/components/blocks/surfaces"
import { Button } from "@/components/ui/button"
import { useApp } from "@/context/app-context"
import { checkMCPStatus } from "@/lib/api"
import { JsonDialog, SettingRow, useSettingsSave } from "./shared"

export function IntegrationsSection() {
  const { settings, acpAgents } = useApp()
  const save = useSettingsSave()
  const [mcpDraft, setMcpDraft] = React.useState<string | null>(null)
  const [mcpChecks, setMcpChecks] = React.useState<{ id: string; name: string; status: string; message?: string }[]>([])
  if (settings === undefined) return <RowsSkeleton rows={6} />

  const mcpJson = mcpDraft ?? settings.mcp_servers_json ?? ""

  return (
    <>
      <Section size="lg" gap="lg" title="MCP 配置" description="为摄入任务提供外部工具。">
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

      <Section size="lg" gap="lg" title="ACP Agent" description="外部 coding agent 已统一收口到 Harness 设置。">
        <Panel padding="none">
          <Rows label="ACP Agent">
            <SettingRow
              label="ACP 配置入口"
              description={`${acpAgents.length} 个已配置；支持在 Harness 设置中管理与探测。`}
              control={<Button size="sm" variant="outline" asChild><AppLink to="/settings/harness">前往 Harness 设置</AppLink></Button>}
            />
          </Rows>
        </Panel>
      </Section>
    </>
  )
}
