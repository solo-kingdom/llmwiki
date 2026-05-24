import { describe, it, expect } from "vitest"
import {
  addContextHref,
  clearAddContextQuery,
  clearDirectIngestQuery,
  directIngestHref,
  getWorkbenchViewFromPath,
  isAddContextRequested,
  isDirectIngestRequested,
  isWikiGraphPath,
  timelineCommitHref,
  wikiGraphHref,
  workbenchViewHref,
} from "@/lib/wiki-routes"

describe("wiki-routes workbench views", () => {
  it("maps root path to chat", () => {
    expect(getWorkbenchViewFromPath("/")).toBe("chat")
    expect(workbenchViewHref("chat")).toBe("/")
  })

  it("maps legacy ingest path to chat", () => {
    expect(getWorkbenchViewFromPath("/ingest")).toBe("chat")
  })

  it("maps legacy review path to chat default view", () => {
    expect(getWorkbenchViewFromPath("/review")).toBe("chat")
  })

  it("builds add context deep link", () => {
    expect(addContextHref()).toBe("/?addContext=1")
    expect(isAddContextRequested("?addContext=1")).toBe(true)
    expect(clearAddContextQuery("?addContext=1&foo=bar")).toBe("/?foo=bar")
    expect(clearAddContextQuery("?addContext=1")).toBe("/")
  })

  it("accepts legacy directIngest query as add context", () => {
    expect(isAddContextRequested("?directIngest=1")).toBe(true)
    expect(isDirectIngestRequested("?directIngest=1")).toBe(true)
    expect(directIngestHref()).toBe("/?addContext=1")
    expect(clearDirectIngestQuery("?directIngest=1&foo=bar")).toBe("/?foo=bar")
  })

  it("builds timeline commit deep link", () => {
    expect(timelineCommitHref("abc123")).toBe("/timeline?commit=abc123")
  })

  it("maps other workbench paths", () => {
    expect(getWorkbenchViewFromPath("/jobs")).toBe("jobs")
    expect(getWorkbenchViewFromPath("/settings")).toBe("settings")
    expect(getWorkbenchViewFromPath("/timeline")).toBe("timeline")
    expect(getWorkbenchViewFromPath("/logs")).toBe("logs")
    expect(getWorkbenchViewFromPath("/graph")).toBe("chat")
  })
})

describe("wiki graph routes", () => {
  it("recognizes wiki graph path", () => {
    expect(isWikiGraphPath("/wiki/graph")).toBe(true)
    expect(isWikiGraphPath("/wiki")).toBe(false)
    expect(wikiGraphHref()).toBe("/wiki/graph")
  })
})
