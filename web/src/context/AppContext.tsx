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
  IngestSessionMessage,
  Provider,
  ModelInfo,
  SessionListItem,
} from "@/types"
import * as api from "@/lib/api"

const SESSION_STORAGE_KEY = "llmwiki.ingest.sessionId"

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

  sessionId: string | null
  sessionMessages: IngestSessionMessage[]
  sessionBusy: boolean
  sessionError: string | null

  sessions: SessionListItem[]
  activeSessionId: string | null
  providers: Provider[]
  currentModels: ModelInfo[]

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

  ensureIngestSession: () => Promise<void>
  sendSessionMessage: (content: string) => Promise<void>
  uploadSessionAttachment: (file: File) => Promise<void>
  archiveSession: (title?: string) => Promise<string>

  loadProviders: () => Promise<void>
  loadModels: (providerId: string) => Promise<void>
  listSessions: () => Promise<void>
  createSession: (provider?: string, model?: string) => Promise<void>
  switchSession: (id: string) => Promise<void>
  updateSessionLLM: (
    id: string,
    provider: string,
    model: string,
  ) => Promise<void>
  updateLastModel: (provider: string, model: string) => Promise<void>
  setProviderKey: (
    providerId: string,
    apiKey: string,
    baseURL?: string,
  ) => Promise<void>
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

  const [sessionId, setSessionId] = useState<string | null>(() =>
    typeof localStorage !== "undefined"
      ? localStorage.getItem(SESSION_STORAGE_KEY)
      : null,
  )
  const [sessionMessages, setSessionMessages] = useState<
    IngestSessionMessage[]
  >([])
  const [sessionBusy, setSessionBusy] = useState(false)
  const [sessionError, setSessionError] = useState<string | null>(null)

  const [sessions, setSessions] = useState<SessionListItem[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [providers, setProviders] = useState<Provider[]>([])
  const [currentModels, setCurrentModels] = useState<ModelInfo[]>([])

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

  const saveSettings = useCallback(async (s: Partial<Settings>) => {
    const updated = await api.updateSettings(s)
    setSettings(updated)
  }, [])

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

  const loadSessionMessages = useCallback(async (id: string) => {
    const { messages } = await api.listIngestSessionMessages(id)
    setSessionMessages(messages)
  }, [])

  const ensureIngestSession = useCallback(async () => {
    if (sessionId) {
      try {
        const { session } = await api.getIngestSession(sessionId)
        if (session.status === "active") {
          await loadSessionMessages(sessionId)
          return
        }
      } catch {
        // create new below
      }
    }
    const provider = settings?.last_provider
    const model = settings?.last_model
    const { session } = await api.createIngestSession()
    setSessionId(session.id)
    setActiveSessionId(session.id)
    localStorage.setItem(SESSION_STORAGE_KEY, session.id)
    setSessionMessages([])
    if (provider && model) {
      try {
        await api.updateIngestSession(session.id, { provider, model })
      } catch {
        // non-critical
      }
    }
  }, [sessionId, loadSessionMessages, settings])

  const sendSessionMessage = useCallback(
    async (content: string) => {
      if (!sessionId) return
      setSessionBusy(true)
      setSessionError(null)
      const tempUser: IngestSessionMessage = {
        id: `temp-user-${Date.now()}`,
        session_id: sessionId,
        role: "user",
        content,
        message_type: "text",
        attachment_id: "",
        stream_status: "complete",
        created_at: new Date().toISOString(),
      }
      const tempAssistant: IngestSessionMessage = {
        id: `temp-assistant-${Date.now()}`,
        session_id: sessionId,
        role: "assistant",
        content: "",
        message_type: "text",
        attachment_id: "",
        stream_status: "streaming",
        created_at: new Date().toISOString(),
      }
      setSessionMessages((prev) => [...prev, tempUser, tempAssistant])
      try {
        await api.streamIngestSessionMessage(sessionId, content, (event, data) => {
          if (event === "user_message" && data && typeof data === "object") {
            const um = data as IngestSessionMessage
            setSessionMessages((prev) =>
              prev.map((m) => (m.id === tempUser.id ? um : m)),
            )
          }
          if (event === "token" && data && typeof data === "object") {
            const tok = (data as { content?: string }).content ?? ""
            setSessionMessages((prev) =>
              prev.map((m) =>
                m.id === tempAssistant.id
                  ? { ...m, content: m.content + tok }
                  : m,
              ),
            )
          }
          if (event === "done" && data && typeof data === "object") {
            const am = data as IngestSessionMessage
            setSessionMessages((prev) =>
              prev.map((m) => (m.id === tempAssistant.id ? am : m)),
            )
          }
          if (event === "error") {
            setSessionMessages((prev) =>
              prev.map((m) =>
                m.id === tempAssistant.id
                  ? { ...m, stream_status: "failed", content: "回复失败" }
                  : m,
              ),
            )
          }
        })
        await loadSessionMessages(sessionId)
      } catch (e) {
        setSessionError((e as Error).message)
        await loadSessionMessages(sessionId)
      } finally {
        setSessionBusy(false)
      }
    },
    [sessionId, loadSessionMessages],
  )

  const uploadSessionAttachment = useCallback(
    async (file: File) => {
      if (!sessionId) return
      setSessionBusy(true)
      setSessionError(null)
      try {
        const { message } = await api.uploadIngestSessionAttachment(
          sessionId,
          file,
        )
        setSessionMessages((prev) => [...prev, message])
      } catch (e) {
        setSessionError((e as Error).message)
      } finally {
        setSessionBusy(false)
      }
    },
    [sessionId],
  )

  const archiveSession = useCallback(
    async (title?: string) => {
      if (!sessionId) throw new Error("no session")
      setSessionBusy(true)
      setSessionError(null)
      try {
        const res = await api.archiveIngestSession(sessionId, title)
        const provider = settings?.last_provider
        const model = settings?.last_model
        const { session } = await api.createIngestSession()
        setSessionId(session.id)
        setActiveSessionId(session.id)
        localStorage.setItem(SESSION_STORAGE_KEY, session.id)
        setSessionMessages([])
        if (provider && model) {
          try {
            await api.updateIngestSession(session.id, { provider, model })
          } catch {
            // non-critical
          }
        }
        void listSessionsInternal()
        return res.job_id
      } catch (e) {
        setSessionError((e as Error).message)
        throw e
      } finally {
        setSessionBusy(false)
      }
    },
    [sessionId, settings],
  )

  const listSessionsInternal = async () => {
    try {
      const { sessions: s } = await api.listIngestSessions()
      setSessions(s)
    } catch {
      // non-critical
    }
  }

  const loadProviders = useCallback(async () => {
    try {
      const p = await api.listProviders()
      setProviders(p)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])

  const loadModels = useCallback(async (providerId: string) => {
    try {
      const m = await api.listProviderModels(providerId)
      setCurrentModels(m)
    } catch (e) {
      setError((e as Error).message)
      setCurrentModels([])
    }
  }, [])

  const listSessions = useCallback(async () => {
    await listSessionsInternal()
  }, [])

  const createSession = useCallback(
    async (provider?: string, model?: string) => {
      const { session } = await api.createIngestSession()
      if (provider && model) {
        try {
          await api.updateIngestSession(session.id, { provider, model })
        } catch {
          // non-critical
        }
      }
      setSessionId(session.id)
      setActiveSessionId(session.id)
      localStorage.setItem(SESSION_STORAGE_KEY, session.id)
      setSessionMessages([])
      await listSessionsInternal()
    },
    [],
  )

  const switchSession = useCallback(
    async (id: string) => {
      setSessionId(id)
      setActiveSessionId(id)
      localStorage.setItem(SESSION_STORAGE_KEY, id)
      await loadSessionMessages(id)
      try {
        const { session } = await api.getIngestSession(id)
        if (session.llm_provider) {
          await loadModels(session.llm_provider)
        }
      } catch {
        // non-critical
      }
    },
    [loadSessionMessages, loadModels],
  )

  const updateSessionLLM = useCallback(
    async (id: string, provider: string, model: string) => {
      await api.updateIngestSession(id, { provider, model })
      await api.updateLastModel(provider, model)
      setSettings((prev) =>
        prev ? { ...prev, last_provider: provider, last_model: model } : prev,
      )
      await listSessionsInternal()
    },
    [],
  )

  const updateLastModelFn = useCallback(
    async (provider: string, model: string) => {
      await api.updateLastModel(provider, model)
      setSettings((prev) =>
        prev ? { ...prev, last_provider: provider, last_model: model } : prev,
      )
    },
    [],
  )

  const setProviderKeyFn = useCallback(
    async (providerId: string, apiKey: string, baseURL?: string) => {
      await api.setProviderKey(providerId, apiKey, baseURL)
      await loadSettings()
      await loadProviders()
    },
    [loadSettings, loadProviders],
  )

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
        sessionId,
        sessionMessages,
        sessionBusy,
        sessionError,
        sessions,
        activeSessionId,
        providers,
        currentModels,
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
        ensureIngestSession,
        sendSessionMessage,
        uploadSessionAttachment,
        archiveSession,
        loadProviders,
        loadModels,
        listSessions,
        createSession,
        switchSession,
        updateSessionLLM,
        updateLastModel: updateLastModelFn,
        setProviderKey: setProviderKeyFn,
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
