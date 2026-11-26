## MCP 接入

首选 **RPC-first** 模式：`llmwiki serve` 在同一进程暴露 MCP HTTP 端点 `POST /mcp`（JSON-RPC 2.0）。

### 本地开发

1. 启动服务：`llmwiki serve ~/research`
2. 生成客户端配置：`llmwiki mcp-config`
3. 将配置粘贴到 Claude Desktop / Claude Code 等 MCP 客户端

### 远程 Agent 接入

远程 MCP 访问需要 **Bearer token 认证**，且默认仅暴露**只读工具**（guide、search、read、references、lint、ping）。

1. 启动服务（远程绑定必须带 token）：
   ```bash
   llmwiki serve ~/research --bind 0.0.0.0 --token your-secret-token
   ```

2. 生成远程 Agent 配置：
   ```bash
   llmwiki mcp-config ~/research --bind 0.0.0.0 --token your-secret-token
   ```
   输出包含 endpoint URL、transport 类型和 Authorization header。

3. 如果需要写入/删除能力，显式启用：
   ```bash
   llmwiki serve ~/research --bind 0.0.0.0 --token your-secret-token --mcp-allow-write
   ```

### 安全建议

- **必须设置 `--token`**：远程绑定（非 127.0.0.1）时未设置 token 将拒绝启动。
- **推荐 HTTPS**：使用 Nginx/Caddy 等反向代理为远程 MCP 提供加密传输。
- **默认只读**：远程 Agent 默认只能读取和搜索知识库，写入需显式 `--mcp-allow-write`。
- **不要在公网无认证暴露 `/mcp`**。

客户端可通过 MCP 工具读取 Wiki、搜索、触发诊断等（具体工具列表以 `tools/list` 为准）。stdio 模式 `llmwiki mcp` 仍可用，但 HTTP RPC 为推荐接入方式。
