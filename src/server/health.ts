import type { Context } from "hono";

export interface HealthState {
  mcpEnabled: boolean;
  authRequired: boolean;
  mcpAllowWrite: boolean;
  acpEnabled: boolean;
}

export function healthHandler(state: HealthState | (() => Promise<HealthState>)) {
  return async (c: Context) => {
    const current = typeof state === "function" ? await state() : state;
    return c.json({
      status: "ok",
      mode: {
        topology: "single-process",
        api_enabled: true,
        web_enabled: true,
        mcp_enabled: current.mcpEnabled,
        mcp_transport: "rpc-http",
        watch_enabled: false,
        acp_enabled: current.acpEnabled,
      },
      mcp_access_model: "rpc-first",
      mcp_auth_required: current.authRequired,
      mcp_default_policy: current.mcpAllowWrite ? "readwrite" : "readonly",
      mcp_compatibility:
        "First release focuses on RPC access. Direct Claude Desktop stdio connection is not a release gate.",
    });
  };
}
