import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { SettingsPage } from "@/components/SettingsPage"

const mockSaveSettings = vi.fn()
const mockLoadSettings = vi.fn()

vi.mock("@/context/AppContext", () => ({
  useApp: () => ({
    settings: {
      mcp_servers_json:
        '{\n  "version": 1,\n  "servers": {},\n  "defaults": {"readonly_only": true}\n}',
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
  initVC: vi.fn(),
  disableVC: vi.fn(),
  checkAllProviderInstances: vi.fn().mockResolvedValue({ instances: [] }),
  checkProviderInstance: vi.fn(),
  checkMCPStatus: vi.fn().mockResolvedValue({ servers: [] }),
}))

describe("SettingsPage MCP JSON", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSaveSettings.mockResolvedValue({
      mcp_servers_json: '{\n  "version": 1,\n  "servers": {}\n}',
    })
  })

  it("renders MCP JSON textarea with settings value", () => {
    render(<SettingsPage />)
    const area = screen.getByTestId("mcp-servers-json") as HTMLTextAreaElement
    expect(area.value).toContain('"version": 1')
  })

  it("shows validation error for invalid JSON", () => {
    render(<SettingsPage />)
    const area = screen.getByTestId("mcp-servers-json")
    fireEvent.change(area, { target: { value: "not-json" } })
    expect(screen.getByTestId("mcp-json-error").textContent).toMatch(
      /not valid JSON/i,
    )
  })

  it("rejects servers array format", () => {
    render(<SettingsPage />)
    const area = screen.getByTestId("mcp-servers-json")
    fireEvent.change(area, {
      target: {
        value: JSON.stringify({ version: 1, servers: [] }),
      },
    })
    expect(screen.getByTestId("mcp-json-error").textContent).toMatch(
      /对象/,
    )
  })

  it("accepts null servers", async () => {
    render(<SettingsPage />)
    const area = screen.getByTestId("mcp-servers-json")
    const valid = JSON.stringify(
      {
        version: 1,
        servers: null,
        defaults: { readonly_only: true, fallback_mode: "local_only" },
      },
      null,
      2,
    )
    fireEvent.change(area, { target: { value: valid } })
    expect(screen.queryByTestId("mcp-json-error")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: /Save Settings/i }))
    await waitFor(() => {
      expect(mockSaveSettings).toHaveBeenCalled()
    })
  })

  it("saves valid MCP JSON", async () => {
    render(<SettingsPage />)
    const area = screen.getByTestId("mcp-servers-json")
    const valid = JSON.stringify(
      { version: 1, servers: {}, defaults: { readonly_only: true } },
      null,
      2,
    )
    fireEvent.change(area, { target: { value: valid } })
    fireEvent.click(screen.getByRole("button", { name: /Save Settings/i }))
    await waitFor(() => {
      expect(mockSaveSettings).toHaveBeenCalled()
    })
  })

  it("runs MCP status check", async () => {
    const { checkMCPStatus } = await import("@/lib/api")
    vi.mocked(checkMCPStatus).mockResolvedValue({
      servers: [
        {
          id: "s1",
          name: "Test",
          enabled: true,
          status: "ok",
          message: "连接正常，2 个可用工具",
          tool_count: 2,
        },
      ],
    })
    render(<SettingsPage />)
    fireEvent.click(screen.getByTestId("check-mcp"))
    await waitFor(() => {
      expect(checkMCPStatus).toHaveBeenCalled()
      expect(screen.getByTestId("mcp-check-s1")).toBeInTheDocument()
    })
  })
})
