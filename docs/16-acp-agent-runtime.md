# ACP Agent Runtime

## 架构

```text
internal/api
  └── internal/agentruntime.Runtime
        ├── native runtime → internal/ingest + internal/llm
        └── ACP runtime → internal/acp → JSON-RPC 2.0 stdio → local agent subprocess
```

`internal/api` 只依赖 `agentruntime.Runtime`。ACP 协议、JSON-RPC 方法、进程和权限选项封装在 `internal/acp`。native 与 ACP 共享 `EventSink`，事件再映射到 SSE 和既有 SQLite 会话表。

## 配置

配置存储在 `app_config.acp_agents_json`。示例：

```json
{
  "version": 1,
  "agents": {
    "codex-acp": {
      "id": "codex-acp",
      "name": "Codex ACP",
      "enabled": true,
      "command": "npx",
      "args": ["-y", "@agentclientprotocol/codex-acp"],
      "env_passthrough": ["PATH", "HOME", "LANG", "OPENAI_API_KEY"],
      "cwd_policy": "workspace",
      "init_timeout_ms": 30000,
      "prompt_timeout_ms": 600000,
      "idle_timeout_ms": 120000,
      "permission": {
        "mode": "auto",
        "allow_read": true,
        "allow_search": true,
        "allow_fetch": false,
        "allow_write": false,
        "allow_execute": false
      }
    }
  },
  "defaults": {
    "readonly_only": true,
    "on_unavailable": "error"
  }
}
```

| 字段 | 必填/默认 | 说明 |
|---|---|---|
| `version` | `1` | 配置 schema 版本 |
| `agents` | 对象 | key 必须与 agent `id` 一致 |
| `enabled` | `false` | 禁用后该 agent 不能被选中或启动 |
| `command` | 必填 | 可执行名或绝对路径；不经 shell；禁止 shell 元字符 |
| `args` | `[]` | 启动参数；禁止凭据参数名和常见 token 形态 |
| `env_passthrough` | `["PATH","HOME","LANG"]` | 只声明变量名；值从 llmwiki 进程环境读取 |
| `cwd_policy` | `workspace` | `workspace` 或 session 私有目录 |
| `init_timeout_ms` | `30000` | initialize + session/new 上限，1000–120000 |
| `prompt_timeout_ms` | `600000` | 单 turn 上限，5000–3600000 |
| `idle_timeout_ms` | `120000` | 无 session/update 的静默上限，5000–600000 |
| `permission.mode` | `auto` | v1 只支持非交互 `auto` |
| `defaults.readonly_only` | `true` | true 时 write/execute 一律拒绝 |
| `defaults.on_unavailable` | `error` | 不支持静默降级 |

## 凭据边界

- 配置模型没有 `env` 或任何存放环境变量值的字段。出现 `env` 键会被显式拒绝。
- 唯一凭据通道是 `env_passthrough`，它只包含变量名。
- 子进程环境是白名单：只有 `env_passthrough` 中当前进程已设置的变量，以及强制保留的 `PATH`。
- `command` 和 `args` 禁止夹带凭据；`--token`、`--api-key`、`Bearer ...`、`sk-*`、GitHub/OpenAI/Slack token 形态等会在保存或检查时拒绝。
- `GET /api/v1/acp-agents` 只返回 `{name, present}`，从不返回变量值。
- stderr 和 JSON-RPC 调试数据在持久化前经过脱敏和截断。

## 权限矩阵

`clientCapabilities` 固定为 `fs.readTextFile=false`、`fs.writeTextFile=false`、`terminal=false`。权限请求只选择 `*_once` 选项：

| Tool kind | 允许条件 | 选择 |
|---|---|---|
| `read` | `allow_read` | `allow_once` / `reject_once` |
| `search` | `allow_search` | `allow_once` / `reject_once` |
| `think` | 恒允许 | `allow_once` |
| `fetch` | `allow_fetch` | `allow_once` / `reject_once` |
| `edit` / `delete` / `move` | `allow_write` 且 `readonly_only=false` | `allow_once` / `reject_once` |
| `execute` | `allow_execute` 且 `readonly_only=false` | `allow_once` / `reject_once` |
| `other` / 未知 / 缺失 | 默认拒绝 | `reject_once` |

每次都只用 `allow_once` / `reject_once`，不会选择 always 选项。无匹配选项时回 `cancelled`。

## 进程生命周期

- session 首次发送消息时懒启动；同一 session 后续 turn 复用进程和 ACP sessionId。
- 并发上限由 `acp_max_concurrent_agents` 控制，超限返回 HTTP 503 + `Retry-After`。
- 子进程使用独立进程组；停止时先对进程组 `SIGTERM`，3 秒后 `SIGKILL`。
- 删除、归档 session 和 server shutdown 会清理对应/全部进程。
- 崩溃发生在首个正文 token 前时自动重启一次；已输出正文时不重试，避免重复内容。
- 新进程没有旧的 agent 上下文时，首轮会把 llmwiki 历史压缩为 `## User` / `## Assistant` 引导文本。
- 取消会发 `session/cancel` 并等待 `cancelled`；5 秒未返回则终止进程组并返回超时错误。

## 事件映射

| ACP update / 请求 | SSE / 持久化 |
|---|---|
| `agent_message_chunk` text | `token`，追加 `ingest_session_messages.content` |
| 非 text content block | `warning` (`acp_unsupported_content`) + debug event |
| `agent_thought_chunk` | `thought` + `session_message_events` |
| `tool_call` | `tool_start` (`{tool, detail}`) + event |
| `tool_call_update` completed/failed | `tool_done` + event |
| `plan` | `plan` + event |
| `usage_update` | debug event only |
| `session/request_permission` | `permission` + event + activity log |
| `stopReason` | `complete` / `incomplete` / `failed` 映射 + debug event |

归档只读取 `ingest_session_messages`，因此 ACP thought/tool/plan 不进入 archive markdown，review/plan/apply 链路不需要感知 runtime。

## 故障排查

| 现象 | 检查 |
|---|---|
| CLI 未找到 | 在 Settings 点击检查连接；确认 `command` 可从 llmwiki 进程的 `PATH` 解析 |
| 版本不匹配 | 探活结果 `protocol_version_unsupported`；llmwiki 当前只实现 ACP v1 |
| 初始化超时 | 检查 `init_timeout_ms`、CLI 首次下载、adapter 启动日志 |
| 静默超时 | 检查 `idle_timeout_ms`；agent 长时间无 session/update 会被取消 |
| 单轮超时 | 检查 `prompt_timeout_ms` 和 agent 工具是否卡住 |
| 进程崩溃 | 查看 message debug events 的 `acp_process_exit`，其中含脱敏 stderr tail |
| `present=false` | 变量名存在但 llmwiki 进程环境没有该变量；重新注入进程环境后重启服务 |

## 开发期调试

`acpx` 只用于开发期手工连 agent、查看原始 ACP 报文，不是 llmwiki 运行时依赖。例如：

```bash
acpx codex --format json --no-fs --no-terminal exec "reply with OK"
```

生产路径由 llmwiki 直接启动 `acp_agents_json` 中的 `command`，不会启动 `acpx`。

## 部署

### lnv 默认镜像

默认 `lwiki:<sha>` 不安装 ACP CLI，不修改 `/home/wii/.agent-deploy/lnv/llmwiki/docker-compose.yml`。`default_agent_kind` 默认 `native`，现有部署行为和镜像体积不变。只有显式配置 ACP session 且 CLI 可用时才会启动子进程。

### 可选 `lwiki-acp:<sha>` 变体

如需在容器内运行 ACP agent，可另建 `lwiki-acp` 标签，基于 `debian:bookworm-slim`，增加 `nodejs` / `npm` 和目标 ACP CLI。必须使用 glibc 基础镜像，不能用 alpine；Node 运行时和 CLI 通常会让镜像增加数百 MB。该变体是可选构建线，不影响默认部署。

### 凭据注入

建议在 compose 中仅对 llmwiki 服务增加：

```yaml
env_file:
  - /home/wii/.agent-deploy/lnv/llmwiki/.env.acp
```

`.env.acp` 权限设为 `600`，不进入任何 git 仓库。`acp_agents_json`、compose 文件和仓库中只出现 `env_passthrough` 变量名，不出现明文值；`args` 也不得写入凭据。

### 部署后验证

```bash
curl -k https://llmwiki.lan/api/v1/health
curl -k https://llmwiki.lan/api/v1/acp-agents
curl -k -X POST https://llmwiki.lan/api/v1/acp-agents/check \
  -H 'Content-Type: application/json' \
  -d '{"acp_agents_json":"{\"version\":1,\"agents\":{}}"}'
docker exec lnv-llmwiki sh -c 'command -v <cli>'
```

确认 health 的 `mode.acp_enabled`、agent 的 `available`、`env_passthrough[].present`，以及 check 的 `status`、`agent_version`、`protocol_version`。
