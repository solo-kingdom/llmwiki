import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { SettingsPage } from "@/components/SettingsPage"

const mockSaveSettings = vi.fn()
const mockLoadSettings = vi.fn()

vi.mock("@/context/AppContext", () => ({
  useApp: () => ({
    settings: {
      ui_language: "zh",
      doc_language: "zh",
      rules_supplement: "",
      mcp_servers_json: "",
      embedding_instance_id: "inst-1",
      embedding_model: "text-embedding-3-small",
      embedding_dim: "1536",
      embedding_configured: true,
    },
    loadSettings: mockLoadSettings,
    saveSettings: mockSaveSettings,
    providers: [],
    loadProviders: vi.fn(),
    instances: [
      {
        id: "inst-1",
        name: "OpenAI",
        catalog_id: "openai",
        api_key_masked: "sk-…",
        base_url: "",
        created_at: "",
        updated_at: "",
      },
    ],
    loadInstances: vi.fn(),
    createInstance: vi.fn(),
    updateInstance: vi.fn(),
    deleteInstance: vi.fn(),
    loadModels: vi.fn(),
    currentModels: [],
    acpAgents: [],
    acpConfigError: null,
    loadACPAgents: vi.fn(),
  }),
}))

vi.mock("@/lib/api", () => ({
  checkAllProviderInstances: vi.fn().mockResolvedValue({ instances: [] }),
  checkProviderInstance: vi.fn(),
  checkMCPStatus: vi.fn().mockResolvedValue({ servers: [] }),
  checkACPAgents: vi.fn().mockResolvedValue({ agents: [] }),
  getWorkspaceRuleFiles: vi.fn().mockResolvedValue({
    purpose_preview: "",
    rules_preview: "",
  }),
}))

describe("SettingsPage layout and save UX", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSaveSettings.mockResolvedValue({ ui_language: "zh" })
  })

  it("renders grouped settings sections", () => {
    render(<SettingsPage />)

    expect(screen.getByTestId("settings-group-basic")).toBeInTheDocument()
    expect(screen.getByTestId("settings-group-models")).toBeInTheDocument()
    expect(screen.getByTestId("settings-group-rules")).toBeInTheDocument()
    expect(screen.getByTestId("settings-group-advanced")).toBeInTheDocument()
    expect(screen.getByText("基础设置")).toBeInTheDocument()
    expect(screen.getByText("模型与连接")).toBeInTheDocument()
  })

  it("shows localized save controls and provider local actions", () => {
    render(<SettingsPage />)

    expect(screen.getByTestId("settings-save-bar")).toBeInTheDocument()
    expect(screen.getByTestId("settings-save-button")).toHaveTextContent("保存设置")
    expect(screen.getByTestId("provider-local-actions")).toBeInTheDocument()
  })

  it("places save bar as the last child of the settings form", () => {
    render(<SettingsPage />)

    const saveBar = screen.getByTestId("settings-save-bar")
    const form = saveBar.closest("form")
    expect(form).not.toBeNull()
    expect(form!.lastElementChild).toBe(saveBar)
  })

  it("shows unsaved state and save feedback after editing", async () => {
    render(<SettingsPage />)

    const saveButton = screen.getByTestId("settings-save-button")
    expect(saveButton).toBeDisabled()
    expect(screen.queryByTestId("settings-unsaved-indicator")).toBeNull()

    fireEvent.change(screen.getByTestId("rules-supplement"), {
      target: { value: "补充规则" },
    })

    expect(screen.getByTestId("settings-unsaved-indicator")).toHaveTextContent(
      "有未保存的更改",
    )
    expect(saveButton).not.toBeDisabled()

    fireEvent.click(saveButton)
    await waitFor(() => {
      expect(mockSaveSettings).toHaveBeenCalledWith({
        rules_supplement: "补充规则",
      })
    })
    await waitFor(() => {
      expect(screen.getByTestId("settings-saved-indicator")).toHaveTextContent(
        "设置已保存",
      )
    })
  })

  it("shows embedding configuration and saves embedding changes", async () => {
    render(<SettingsPage />)

    expect(await screen.findByTestId("embedding-status")).toHaveTextContent("已配置")
    expect(screen.getByTestId("embedding-instance")).toHaveValue("inst-1")
    expect(screen.getByTestId("embedding-model")).toHaveValue(
      "text-embedding-3-small",
    )
    expect(screen.getByTestId("embedding-dim")).toHaveValue(1536)

    fireEvent.change(screen.getByTestId("embedding-model"), {
      target: { value: "text-embedding-3-large" },
    })
    fireEvent.click(screen.getByTestId("settings-save-button"))

    await waitFor(() => {
      expect(mockSaveSettings).toHaveBeenCalledWith({
        embedding_model: "text-embedding-3-large",
      })
    })
  })

  it("saves the default ACP runtime through the page save bar", async () => {
    render(<SettingsPage />)
    fireEvent.change(screen.getByTestId("acp-default-agent-kind"), { target: { value: "acp" } })
    const saveButton = screen.getByTestId("settings-save-button")
    expect(saveButton).not.toBeDisabled()
    fireEvent.click(saveButton)
    await waitFor(() => {
      expect(mockSaveSettings).toHaveBeenCalledWith(expect.objectContaining({ default_agent_kind: "acp" }))
    })
  })
})

describe("API token setting", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSaveSettings.mockResolvedValue({ ui_language: "zh" })
  })

  it("saves the token typed by the user and explains the active source", async () => {
    render(<SettingsPage />)

    expect(screen.getByText(/尚未设置令牌/)).toBeInTheDocument()

    fireEvent.change(screen.getByTestId("api-token"), { target: { value: "bearer-token-abc" } })
    fireEvent.click(screen.getByRole("button", { name: /保存/ }))

    await waitFor(() =>
      expect(mockSaveSettings).toHaveBeenCalledWith(expect.objectContaining({ api_token: "bearer-token-abc" })),
    )
  })
})
