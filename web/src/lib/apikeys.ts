/** Agent API Key：curl 示例与一键复制的 agent 接入话术。 */

/** solo-skills 中承载 agent 接入操作规范的 skill（project-design-patterns）安装命令。 */
export const AGENT_SKILL_INSTALL_CMD =
  "npx skills add sunzhenkai/solo-skills -s project-design-patterns -g -y"

/** 归一化服务基址，去掉末尾多余斜杠。 */
export function normalizeApiBase(apiBase: string): string {
  return apiBase.trim().replace(/\/+$/, "")
}

/** curl 调用示例（key 用占位或刚创建的明文）。 */
export function apiKeyCurlExample(apiBase: string, key = "llmwiki_sk_xxx"): string {
  const base = normalizeApiBase(apiBase)
  return [
    `curl ${base}/api/v1/workspace \\`,
    `  -H 'Authorization: Bearer ${key}'`,
  ].join("\n")
}

/**
 * 一键复制给 agent 的接入话术：安装通用 skill + 保存 base/key + 应用 skill 接口地址。
 * API 详情不内嵌：project-design-patterns 内的 agent-api-ops 规范会优先 fetch {base}/skill.md（随部署版本发布，权威且不漂移）。
 */
export function agentHandoffText(apiBase: string, key: string): string {
  const base = normalizeApiBase(apiBase)
  return [
    "请完成 llmwiki 的 agent 接入，之后通过 HTTP API 帮我管理知识库（查询、读写页面、目录整理、摄取、Lint 检查与历史回滚等）：",
    "",
    `1. 安装通用操作 skill（全局）：\n   ${AGENT_SKILL_INSTALL_CMD}`,
    "2. 按 skill 的约定把以下接入信息保存为长期配置（含密钥，勿写入公开仓或外发）：",
    `   - API Base: ${base}`,
    `   - API Key: ${key}`,
    `   - 应用 skill 接口: ${base}/skill.md（该部署版本 API 的权威说明，各阶段文档索引见 ${base}/api/v1/skills）`,
    "3. 所有 `/api/v1/*` 请求带 Header `Authorization: Bearer <API Key>`；先按 skill 流程保存凭证并探活，再 fetch 上面的 skill.md，按其端点操作。401 表示 Key 已失效，提醒我在 llmwiki 设置 › 访问控制 重建。",
    "",
    "注意：API Key 不能管理凭证（api-keys 与 settings.api_token），凭证管理请在 llmwiki Web 端进行。",
  ].join("\n")
}
