import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { LogsPage } from "@/components/LogsPage"
import * as api from "@/lib/api"

vi.mock("@/lib/api", () => ({
  listActivityLogs: vi.fn(),
  clearActivityLogs: vi.fn(),
}))

describe("LogsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(api.listActivityLogs).mockResolvedValue({
      logs: [],
      total: 0,
      limit: 50,
      offset: 0,
      has_more: false,
    })
  })

  it("shows empty state and polls logs", async () => {
    render(<LogsPage />)
    expect(await screen.findByText("暂无系统日志")).toBeInTheDocument()
    await waitFor(() => {
      expect(api.listActivityLogs).toHaveBeenCalled()
    })
  })

  it("confirms before clearing all logs", async () => {
    vi.mocked(api.clearActivityLogs).mockResolvedValue({ deleted_count: 3 })
    render(<LogsPage />)
    fireEvent.click(screen.getByRole("button", { name: "清空全部日志" }))
    expect(
      screen.getByText(/将永久删除所有系统日志/),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "确认清空" }))
    await waitFor(() => {
      expect(api.clearActivityLogs).toHaveBeenCalled()
    })
  })
})
