import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { Toast } from "@/components/Toast"

describe("Toast", () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it("auto-dismisses after the configured duration", async () => {
    vi.useFakeTimers()
    const onClose = vi.fn()

    const { rerender } = render(
      <Toast message={null} onClose={onClose} duration={3000} />,
    )
    rerender(<Toast message="已提交归档任务：job-1" onClose={onClose} duration={3000} />)

    expect(screen.getByText("已提交归档任务：job-1")).toBeInTheDocument()

    await vi.advanceTimersByTimeAsync(3000)

    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
