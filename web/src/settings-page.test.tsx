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
    },
    loadSettings: mockLoadSettings,
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
  }),
}))

vi.mock("@/lib/api", () => ({
  getVCStatus: vi.fn().mockResolvedValue({ enabled: false, git_available: true }),
  checkAllProviderInstances: vi.fn().mockResolvedValue({ instances: [] }),
  checkProviderInstance: vi.fn(),
  checkMCPStatus: vi.fn().mockResolvedValue({ servers: [] }),
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
    expect(screen.getByTestId("settings-group-vc")).toBeInTheDocument()
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
})
