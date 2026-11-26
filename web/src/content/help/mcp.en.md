## MCP Integration

**RPC-first** access: `llmwiki serve` exposes MCP at `POST /mcp` (JSON-RPC 2.0) in the same process.

### Local Development

1. Start: `llmwiki serve ~/research`
2. Generate config: `llmwiki mcp-config`
3. Paste into your MCP client (Claude Desktop, Claude Code, etc.)

### Remote Agent Access

Remote MCP access requires **Bearer token authentication** and defaults to **readonly tools** only (guide, search, read, references, lint, ping).

1. Start with remote binding (token is required for non-loopback):
   ```bash
   llmwiki serve ~/research --bind 0.0.0.0 --token your-secret-token
   ```

2. Generate remote agent config:
   ```bash
   llmwiki mcp-config ~/research --bind 0.0.0.0 --token your-secret-token
   ```
   Output includes endpoint URL, transport type, and Authorization header.

3. If write/delete tools are needed, enable explicitly:
   ```bash
   llmwiki serve ~/research --bind 0.0.0.0 --token your-secret-token --mcp-allow-write
   ```

### Security Recommendations

- **Token is mandatory**: Remote binds (non-127.0.0.1) without `--token` will be rejected at startup.
- **Use HTTPS**: Place behind Nginx/Caddy or another reverse proxy for encrypted transport.
- **Readonly by default**: Remote agents can only read and search by default; write access requires `--mcp-allow-write`.
- **Never expose unauthenticated `/mcp` on public networks**.

Tools expose wiki read, search, diagnostics, and more (see `tools/list`). Stdio `llmwiki mcp` remains available; HTTP RPC is the recommended path.
