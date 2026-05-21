import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { WorkbenchLayout } from "@/components/WorkbenchLayout"
import { JobsPage } from "@/components/JobsPage"
import { WikiReaderLayout } from "@/components/WikiReaderLayout"
import { I18nTestProvider, CJK_PATTERN } from "@/test/i18n"

vi.mock("@/context/AppContext", () => ({
  AppProvider: ({ children }: { children: React.ReactNode }) => children,
  useApp: () => ({
    settings: { ui_language: "en", doc_language: "en" },
    loadSettings: vi.fn(),
    ingestJobs: [],
    refreshIngestJobs: vi.fn(),
    retryIngest: vi.fn(),
    cancelIngest: vi.fn(),
    capabilities: { runtime_dependencies: [] },
    loadCapabilities: vi.fn(),
    instances: [],
    providers: [],
    sessions: [],
    activeSessionId: null,
    sessionBusy: false,
    sessionId: null,
    sessionMessages: [],
    currentModels: [],
    listSessions: vi.fn(),
    loadInstances: vi.fn(),
    createSession: vi.fn(),
    switchSession: vi.fn(),
    deleteSession: vi.fn(),
    ensureIngestSession: vi.fn(),
    refreshDocuments: vi.fn(),
  }),
}))

vi.mock("@/context/WikiReaderContext", () => ({
  WikiReaderProvider: ({ children }: { children: React.ReactNode }) => children,
  useWikiReader: () => ({
    currentDoc: null,
    loading: false,
    publicWikiEnabled: true,
    error: null,
    documents: [],
    search: vi.fn(),
    searchResults: null,
    searchQuery: "",
    clearSearch: vi.fn(),
    selectDocument: vi.fn(),
  }),
}))

describe("ui_language switching", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("renders English navigation when lang is en", () => {
    render(
      <I18nTestProvider lang="en">
        <WorkbenchLayout />
      </I18nTestProvider>,
    )

    expect(screen.getByRole("button", { name: "Chat" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Ingest" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Jobs" })).toBeInTheDocument()
    expect(screen.getByRole("navigation").textContent).not.toMatch(CJK_PATTERN)
  })

  it("renders English jobs empty state when lang is en", () => {
    render(
      <I18nTestProvider lang="en">
        <JobsPage />
      </I18nTestProvider>,
    )

    expect(screen.getByText("No ingest jobs")).toBeInTheDocument()
    expect(screen.queryByText(/[\u4e00-\u9fff]/)).not.toBeInTheDocument()
  })

  it("renders English wiki reader chrome when lang is en", () => {
    render(
      <I18nTestProvider lang="en">
        <WikiReaderLayout />
      </I18nTestProvider>,
    )

    expect(screen.getByText("Manage workbench")).toBeInTheDocument()
    expect(screen.getByText("Public reading")).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(CJK_PATTERN)
  })
})
