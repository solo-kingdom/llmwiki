import { describe, it, expect } from "vitest"
import {
  getWorkbenchViewFromPath,
  workbenchViewHref,
} from "@/lib/wiki-routes"

describe("wiki-routes workbench views", () => {
  it("maps root path to chat", () => {
    expect(getWorkbenchViewFromPath("/")).toBe("chat")
    expect(workbenchViewHref("chat")).toBe("/")
  })

  it("maps ingest path", () => {
    expect(getWorkbenchViewFromPath("/ingest")).toBe("ingest")
    expect(workbenchViewHref("ingest")).toBe("/ingest")
  })

  it("maps review path", () => {
    expect(getWorkbenchViewFromPath("/review")).toBe("review")
    expect(workbenchViewHref("review")).toBe("/review")
  })

  it("maps other workbench paths", () => {
    expect(getWorkbenchViewFromPath("/jobs")).toBe("jobs")
    expect(getWorkbenchViewFromPath("/settings")).toBe("settings")
    expect(getWorkbenchViewFromPath("/timeline")).toBe("timeline")
    expect(getWorkbenchViewFromPath("/logs")).toBe("logs")
    expect(getWorkbenchViewFromPath("/graph")).toBe("graph")
    expect(workbenchViewHref("graph")).toBe("/graph")
  })
})
