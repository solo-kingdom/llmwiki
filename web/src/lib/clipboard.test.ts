import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { copyTextToClipboard } from "@/lib/clipboard"

describe("copyTextToClipboard", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("uses navigator.clipboard when available", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal("navigator", { clipboard: { writeText } })

    await expect(copyTextToClipboard("hello")).resolves.toBe(true)
    expect(writeText).toHaveBeenCalledWith("hello")
  })

  it("falls back to execCommand when clipboard API fails", async () => {
    vi.stubGlobal("navigator", {
      clipboard: {
        writeText: vi.fn().mockRejectedValue(new Error("denied")),
      },
    })
    const execCommand = vi.fn().mockReturnValue(true)
    Object.defineProperty(document, "execCommand", {
      value: execCommand,
      configurable: true,
    })

    await expect(copyTextToClipboard("fallback")).resolves.toBe(true)
    expect(execCommand).toHaveBeenCalledWith("copy")
  })
})
