import * as React from "react"
import { RowsSkeleton } from "@/components/blocks/state-boundary"
import { notify } from "@/components/blocks/notify"
import { StatusBadge } from "@/components/blocks/status-badge"
import { Panel, Row, Rows, Section, Stack } from "@/components/blocks/surfaces"
import { useApp } from "@/context/app-context"
import { checkACPAgents, checkMCPStatus } from "@/lib/api"
import type { ACPAgentCheckResult } from "@/types"
import { JsonDialog, SettingRow, useSettingsSave } from "./shared"

export function IntegrationsSection() {
  const { settings, acpAgents } = useApp()
  const save = useSettingsSave()
  const [acpDraft, setAcpDraft] = React.useState<string | null>(null)
  const [mcpDraft, setMcpDraft] = React.useState<string | null>(null)
  const [acpChecks, setAcpChecks] = React.useState<ACPAgentCheckResult[]>([])
  const [mcpChecks, setMcpChecks] = React.useState<{ id: string; name: string; status: string; message?: string }[]>([])
  if (settings === undefined) return <RowsSkeleton rows={6} />

  const acpJson = acpDraft ?? settings.acp_agents_json ?? ""
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

      <Section size="lg" gap="lg" title="ACP Agent" description="外部 coding agent，经 stdio JSON-RPC 接入。">
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
    </>
  )
}
