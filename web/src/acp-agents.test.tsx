import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { SettingsPage } from "@/components/SettingsPage"

const mockSaveSettings = vi.fn()
const mockCheckACPAgents = vi.fn()
const mockLoadACPAgents = vi.fn()
let mockACPAgents: Array<Record<string, unknown>> = []

vi.mock("@/context/AppContext", () => ({
  useApp: () => ({
    settings: {
      ui_language: "zh",
      doc_language: "zh",
      rules_supplement: "",
      mcp_servers_json: "",
      acp_agents_json: "{\"version\":1,\"agents\":{},\"defaults\":{\"readonly_only\":true}}",
      default_agent_kind: "native",
      default_acp_agent_id: "",
      acp_max_concurrent_agents: "4",
    },
    loadSettings: vi.fn(),
    saveSettings: mockSaveSettings,
    providers: [],
    loadProviders: vi.fn(),
    instances: [],
    loadInstances: vi.fn(),
    createInstance: vi.fn(),
    updateInstance: vi.fn(),
    deleteInstance: vi.fn(),
    loadModels: vi.fn(),
    currentModels: [],
    acpAgents: mockACPAgents,
    acpConfigError: null,
    loadACPAgents: mockLoadACPAgents,
  }),
}))

vi.mock("@/lib/api", () => ({
  getVCStatus: vi.fn().mockResolvedValue({ enabled: false, git_available: true }),
  setVCSRemote: vi.fn(),
  backupVC: vi.fn(),
  pushVC: vi.fn(),
  checkProviderInstance: vi.fn(),
  checkAllProviderInstances: vi.fn().mockResolvedValue({ instances: [] }),
  checkMCPStatus: vi.fn().mockResolvedValue({ servers: [] }),
  checkACPAgents: (...args: unknown[]) => mockCheckACPAgents(...args),
  getWorkspaceRuleFiles: vi.fn().mockResolvedValue({ purpose_preview: "", rules_preview: "" }),
}))

describe("Settings ACP agents", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockACPAgents = []
    mockSaveSettings.mockResolvedValue({})
    mockCheckACPAgents.mockResolvedValue({ agents: [] })
  })

  it("renders the ACP card inside the models group", () => {
    render(<SettingsPage />)
    const card = screen.getByTestId("settings-acp-agents")
    expect(screen.getByTestId("settings-group-models")).toContainElement(card)
  })

  it("shows check results for ok, error, and disabled states", async () => {
    mockCheckACPAgents.mockResolvedValue({
      agents: [
        { id: "ok", name: "OK", enabled: true, status: "ok", agent_name: "fake", agent_version: "1.0", protocol_version: 1 },
        { id: "bad", name: "Bad", enabled: true, status: "error", code: "cli_not_found", message: "missing" },
        { id: "off", name: "Off", enabled: false, status: "disabled" },
      ],
    })
    render(<SettingsPage />)
    fireEvent.click(screen.getByTestId("check-acp-agents"))
    await waitFor(() => expect(mockCheckACPAgents).toHaveBeenCalled())
    expect(await screen.findByTestId("acp-check-ok")).toBeInTheDocument()
    expect(screen.getByTestId("acp-check-bad")).toHaveTextContent("missing")
    expect(screen.getByTestId("acp-check-off")).toHaveTextContent("disabled")
  })

  it("displays validation path for invalid JSON from the check endpoint", async () => {
    mockCheckACPAgents.mockRejectedValue(new Error("agents.x.cwd_policy: must be workspace or session"))
    render(<SettingsPage />)
    fireEvent.change(screen.getByTestId("acp-agents-json"), { target: { value: "{" } })
    fireEvent.click(screen.getByTestId("check-acp-agents"))
    expect(await screen.findByTestId("acp-json-error")).toHaveTextContent("agents.x.cwd_policy")
  })

  it("shows env var names and presence without exposing values", () => {
    mockACPAgents = [{
      id: "x",
      name: "Agent X",
      enabled: true,
      command: "agent",
      args: [],
      cwd_policy: "workspace",
      permission: { mode: "auto", allow_read: true, allow_search: true, allow_fetch: false, allow_write: false, allow_execute: false },
      env_passthrough: [
        { name: "SOME_PROVIDER_API_KEY", present: true },
        { name: "GITHUB_TOKEN", present: false },
      ],
      available: true,
    }]
    render(<SettingsPage />)
    expect(screen.getByTestId("acp-env-statuses")).toHaveTextContent("SOME_PROVIDER_API_KEY")
    expect(screen.getByTestId("acp-env-statuses")).toHaveTextContent("已设置")
    expect(screen.getByTestId("acp-env-statuses")).toHaveTextContent("GITHUB_TOKEN")
    expect(screen.getByTestId("acp-env-statuses")).toHaveTextContent("未设置")
    expect(screen.queryByDisplayValue("secret-value")).toBeNull()
  })

  it("warns when readonly_only is disabled", () => {
    render(<SettingsPage />)
    fireEvent.change(screen.getByTestId("acp-agents-json"), {
      target: { value: "{\"version\":1,\"agents\":{},\"defaults\":{\"readonly_only\":false}}" },
    })
    expect(screen.getByTestId("acp-write-warning")).toBeInTheDocument()
  })
})
