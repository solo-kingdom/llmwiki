/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from "react"
import type {
  Document,
  DocumentListItem,
  SearchResponse,
  Settings,
  IngestJob,
  UploadIngestResponse,
  CapabilitiesResponse,
} from "@/types"
import * as api from "@/lib/api"

interface AppState {
  documents: DocumentListItem[]
  currentDoc: Document | null
  currentDocId: string | null
  searchResults: SearchResponse | null
  settings: Settings | null
  loading: boolean
  error: string | null
  searchQuery: string
  ingestJobs: IngestJob[]
  capabilities: CapabilitiesResponse | null

  selectDocument: (id: string) => void
  search: (q: string) => void
  clearSearch: () => void
  refreshDocuments: () => void
  loadSettings: () => void
  saveSettings: (s: Partial<Settings>) => Promise<void>
  refreshIngestJobs: () => Promise<void>
  submitConversation: (payload: {
    content: string
    title?: string
    source_ref?: string
  }) => Promise<void>
  submitText: (payload: {
    content: string
    title?: string
    filename?: string
    source_ref?: string
  }) => Promise<void>
  submitUpload: (files: File[]) => Promise<UploadIngestResponse>
  retryIngest: (id: string) => Promise<void>
  cancelIngest: (id: string) => Promise<void>
  loadCapabilities: () => Promise<void>
}

const AppContext = createContext<AppState | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  const [documents, setDocuments] = useState<DocumentListItem[]>([])
  const [currentDoc, setCurrentDoc] = useState<Document | null>(null)
  const [currentDocId, setCurrentDocId] = useState<string | null>(null)
  const [searchResults, setSearchResults] = useState<SearchResponse | null>(
    null,
  )
  const [searchQuery, setSearchQuery] = useState("")
  const [settings, setSettings] = useState<Settings | null>(null)
  const [ingestJobs, setIngestJobs] = useState<IngestJob[]>([])
  const [capabilities, setCapabilities] = useState<CapabilitiesResponse | null>(
    null,
  )
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refreshDocuments = useCallback(() => {
    api
      .listDocuments()
      .then(setDocuments)
      .catch((e) => setError(e.message))
  }, [])

  useEffect(() => {
    refreshDocuments()
  }, [refreshDocuments])

  const selectDocument = useCallback(
    (id: string) => {
      if (id === currentDocId) return
      setCurrentDocId(id)
      setCurrentDoc(null)
      setLoading(true)
      setError(null)
      api
        .getDocument(id)
        .then((doc) => {
          setCurrentDoc(doc)
        })
        .catch((e) => setError(e.message))
        .finally(() => setLoading(false))
    },
    [currentDocId],
  )

  const search = useCallback((q: string) => {
    if (!q.trim()) {
      setSearchResults(null)
      setSearchQuery("")
      return
    }
    setSearchQuery(q)
    api
      .searchDocuments(q)
      .then(setSearchResults)
      .catch((e) => setError(e.message))
  }, [])

  const clearSearch = useCallback(() => {
    setSearchResults(null)
    setSearchQuery("")
  }, [])

  const loadSettings = useCallback(() => {
    api
      .getSettings()
      .then(setSettings)
      .catch((e) => setError(e.message))
  }, [])

  const saveSettings = useCallback(
    async (s: Partial<Settings>) => {
      const updated = await api.updateSettings(s)
      setSettings(updated)
    },
    [],
  )

  const refreshIngestJobs = useCallback(async () => {
    try {
      const jobs = await api.listIngestJobs()
      setIngestJobs(jobs)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])

  const submitConversation = useCallback(
    async (payload: { content: string; title?: string; source_ref?: string }) => {
      await api.createConversationIngestJob(payload)
      await refreshIngestJobs()
    },
    [refreshIngestJobs],
  )

  const submitText = useCallback(
    async (payload: {
      content: string
      title?: string
      filename?: string
      source_ref?: string
    }) => {
      await api.createTextIngestJob(payload)
      await refreshIngestJobs()
    },
    [refreshIngestJobs],
  )

  const submitUpload = useCallback(
    async (files: File[]) => {
      const result = await api.uploadIngestJobs(files)
      await refreshIngestJobs()
      return result
    },
    [refreshIngestJobs],
  )

  const retryIngest = useCallback(
    async (id: string) => {
      await api.retryIngestJob(id)
      await refreshIngestJobs()
    },
    [refreshIngestJobs],
  )

  const cancelIngest = useCallback(
    async (id: string) => {
      await api.cancelIngestJob(id)
      await refreshIngestJobs()
    },
    [refreshIngestJobs],
  )

  const loadCapabilities = useCallback(async () => {
    try {
      const caps = await api.getCapabilities()
      setCapabilities(caps)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])

  return (
    <AppContext.Provider
      value={{
        documents,
        currentDoc,
        currentDocId,
        searchResults,
        searchQuery,
        settings,
        ingestJobs,
        capabilities,
        loading,
        error,
        selectDocument,
        search,
        clearSearch,
        refreshDocuments,
        loadSettings,
        saveSettings,
        refreshIngestJobs,
        submitConversation,
        submitText,
        submitUpload,
        retryIngest,
        cancelIngest,
        loadCapabilities,
      }}
    >
      {children}
    </AppContext.Provider>
  )
}

export function useApp(): AppState {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error("useApp must be used within AppProvider")
  return ctx
}
