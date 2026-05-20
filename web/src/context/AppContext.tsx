/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
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
  ProviderInstance,
  ModelInfo,
  SessionListItem,
} from "@/types"
import * as api from "@/lib/api"
import { Toast } from "@/components/Toast"

const SESSION_STORAGE_KEY = "llmwiki.ingest.sessionId"

function streamErrorMessage(data: unknown): string {
  if (data && typeof data === "object" && "message" in data) {
    const msg = (data as { message?: string }).message
    if (msg) return msg
  }
  if (typeof data === "string" && data.trim()) return data
  return "回复失败"
}

function hasStreamingAssistant(messages: IngestSessionMessage[]): boolean {
  return messages.some(
    (m) => m.role === "assistant" && m.stream_status === "streaming",
  )
}

function mergeLoadedSessionMessages(
  prev: IngestSessionMessage[],
  loaded: IngestSessionMessage[],
): IngestSessionMessage[] {
  const failedLocal = [...prev]
    .reverse()
    .find((m) => m.stream_status === "failed" && m.error_message)
  if (!failedLocal?.error_message) return loaded

  let lastFailedIdx = -1
  for (let i = loaded.length - 1; i >= 0; i--) {
    if (
      loaded[i].role === "assistant" &&
      loaded[i].stream_status === "failed"
    ) {
      lastFailedIdx = i
      break
    }
  }
  if (lastFailedIdx < 0) return loaded

  return loaded.map((m, i) =>
    i === lastFailedIdx
      ? {
          ...m,
          error_message: failedLocal.error_message,
          content: m.content || failedLocal.error_message || m.content,
        }
      : m,
  )
}

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
  instances: ProviderInstance[]
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
  loadInstances: () => Promise<void>
  createInstance: (payload: {
    name: string
    catalog_id: string
    api_key: string
    base_url?: string
  }) => Promise<ProviderInstance | null>
  updateInstance: (
    id: string,
    payload: {
      name?: string
      catalog_id?: string
      api_key?: string
      base_url?: string
    },
  ) => Promise<ProviderInstance | null>
  deleteInstance: (id: string) => Promise<boolean>
  listSessions: () => Promise<void>
  createSession: (instanceId?: string, model?: string) => Promise<void>
  switchSession: (id: string) => Promise<void>
  deleteSession: (id: string) => Promise<void>
  updateSessionLLM: (
    id: string,
    instanceId: string,
    model: string,
  ) => Promise<void>
  updateLastModel: (instanceId: string, model: string) => Promise<void>

  toastMessage: string | null
  showToast: (message: string) => void
  dismissToast: () => void
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
  const [toastMessage, setToastMessage] = useState<string | null>(null)

  const showToast = useCallback((message: string) => {
    setToastMessage(message)
  }, [])
  const dismissToast = useCallback(() => setToastMessage(null), [])

  useEffect(() => {
    if (!sessionError) return
    setToastMessage(sessionError)
    setSessionError(null)
  }, [sessionError])

  const [sessions, setSessions] = useState<SessionListItem[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [providers, setProviders] = useState<Provider[]>([])
  const [instances, setInstances] = useState<ProviderInstance[]>([])
  const [currentModels, setCurrentModels] = useState<ModelInfo[]>([])
  const loadedModelsProviderRef = useRef<string | null>(null)
  const activeStreamRef = useRef(false)
  const pollGenerationRef = useRef(0)

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
    setSessionMessages((prev) => mergeLoadedSessionMessages(prev, messages))
    return messages
  }, [])

  const watchStreamingMessages = useCallback(async (id: string) => {
    if (activeStreamRef.current) return

    const generation = ++pollGenerationRef.current
    setSessionBusy(true)
    const startedAt = Date.now()
    const timeoutMs = 5 * 60 * 1000

    try {
      while (!activeStreamRef.current && generation === pollGenerationRef.current) {
        if (Date.now() - startedAt > timeoutMs) {
          setSessionError("等待回复超时，请刷新重试")
          break
        }

        let messages: IngestSessionMessage[]
        try {
          const res = await api.listIngestSessionMessages(id)
          messages = res.messages
        } catch {
          break
        }

        setSessionMessages((prev) => mergeLoadedSessionMessages(prev, messages))
        if (!hasStreamingAssistant(messages)) break

        await new Promise((resolve) => setTimeout(resolve, 500))
      }
    } finally {
      if (!activeStreamRef.current && generation === pollGenerationRef.current) {
        setSessionBusy(false)
      }
    }
  }, [])

  const loadSessionMessagesAndWatch = useCallback(
    async (id: string) => {
      const messages = await loadSessionMessages(id)
      if (!activeStreamRef.current && hasStreamingAssistant(messages)) {
        void watchStreamingMessages(id)
      }
    },
    [loadSessionMessages, watchStreamingMessages],
  )

  const ensureIngestSession = useCallback(async () => {
    if (sessionId) {
      try {
        const { session } = await api.getIngestSession(sessionId)
        if (session.status === "active") {
          await loadSessionMessagesAndWatch(sessionId)
          return
        }
      } catch {
        // session not found or error — clear stale ID and create new below
        setSessionId(null)
        setActiveSessionId(null)
        localStorage.removeItem(SESSION_STORAGE_KEY)
      }
    }
    try {
      const instanceId = settings?.last_instance_id
      const model = settings?.last_model
      const { session } = await api.createIngestSession()
      setSessionId(session.id)
      setActiveSessionId(session.id)
      localStorage.setItem(SESSION_STORAGE_KEY, session.id)
      setSessionMessages([])
      setSessionError(null)
      if (instanceId && model) {
        try {
          await api.updateIngestSession(session.id, { instance_id: instanceId, model })
        } catch {
          // non-critical
        }
      }
    } catch (e) {
      // Clear stale session ID to prevent retry loops
      setSessionId(null)
      setActiveSessionId(null)
      localStorage.removeItem(SESSION_STORAGE_KEY)
      setSessionError((e as Error).message)
    }
  }, [sessionId, loadSessionMessagesAndWatch, settings])

  const sendSessionMessage = useCallback(
    async (content: string) => {
      if (!sessionId) return
      pollGenerationRef.current += 1
      activeStreamRef.current = true
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
      const assistantIdRef = { current: tempAssistant.id }
      const isStreamingAssistant = (id: string) =>
        id === assistantIdRef.current || id === tempAssistant.id

      setSessionMessages((prev) => [...prev, tempUser, tempAssistant])
      try {
        await api.streamIngestSessionMessage(sessionId, content, (event, data) => {
          if (event === "user_message" && data && typeof data === "object") {
            const um = data as IngestSessionMessage
            setSessionMessages((prev) =>
              prev.map((m) => (m.id === tempUser.id ? um : m)),
            )
          }
          if (
            event === "assistant_start" &&
            data &&
            typeof data === "object"
          ) {
            const serverId = (data as { id?: string }).id
            if (serverId) {
              assistantIdRef.current = serverId
              setSessionMessages((prev) =>
                prev.map((m) =>
                  m.id === tempAssistant.id ? { ...m, id: serverId } : m,
                ),
              )
            }
          }
          if (event === "token" && data && typeof data === "object") {
            const tok = (data as { content?: string }).content ?? ""
            setSessionMessages((prev) =>
              prev.map((m) =>
                isStreamingAssistant(m.id)
                  ? { ...m, content: m.content + tok }
                  : m,
              ),
            )
          }
          if (event === "done" && data && typeof data === "object") {
            const am = data as IngestSessionMessage
            setSessionMessages((prev) =>
              prev.map((m) => {
                if (!isStreamingAssistant(m.id)) return m
                if (m.stream_status === "failed") return m
                return am
              }),
            )
          }
          if (event === "error") {
            const reason = streamErrorMessage(data)
            setSessionMessages((prev) =>
              prev.map((m) =>
                isStreamingAssistant(m.id)
                  ? {
                      ...m,
                      stream_status: "failed",
                      error_message: reason,
                      content: m.content || reason,
                    }
                  : m,
              ),
            )
          }
        })
        const { messages: loaded } = await api.listIngestSessionMessages(sessionId)
        setSessionMessages((prev) => mergeLoadedSessionMessages(prev, loaded))
      } catch (e) {
        const reason = (e as Error).message
        setSessionError(reason)
        setSessionMessages((prev) =>
          prev.map((m) =>
            isStreamingAssistant(m.id)
              ? {
                  ...m,
                  stream_status: "failed",
                  error_message: reason,
                  content: m.content || reason,
                }
              : m,
          ),
        )
        try {
          const { messages: loaded } =
            await api.listIngestSessionMessages(sessionId)
          setSessionMessages((prev) => mergeLoadedSessionMessages(prev, loaded))
        } catch {
          // keep optimistic failed message
        }
      } finally {
        activeStreamRef.current = false
        setSessionBusy(false)
      }
    },
    [sessionId],
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
        const instanceId = settings?.last_instance_id
        const model = settings?.last_model
        const { session } = await api.createIngestSession()
        setSessionId(session.id)
        setActiveSessionId(session.id)
        localStorage.setItem(SESSION_STORAGE_KEY, session.id)
        setSessionMessages([])
        if (instanceId && model) {
          try {
            await api.updateIngestSession(session.id, { instance_id: instanceId, model })
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
    if (loadedModelsProviderRef.current === providerId) return
    loadedModelsProviderRef.current = providerId
    try {
      const m = await api.listProviderModels(providerId)
      setCurrentModels(m)
    } catch (e) {
      loadedModelsProviderRef.current = null
      setError((e as Error).message)
      setCurrentModels([])
    }
  }, [])

  const loadInstances = useCallback(async () => {
    try {
      const { instances: inst } = await api.listProviderInstances()
      setInstances(inst)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])

  const createInstanceFn = useCallback(async (payload: {
    name: string
    catalog_id: string
    api_key: string
    base_url?: string
  }) => {
    try {
      const { instance } = await api.createProviderInstance(payload)
      await loadInstances()
      return instance
    } catch (e) {
      setError((e as Error).message)
      return null
    }
  }, [loadInstances])

  const updateInstanceFn = useCallback(async (id: string, payload: {
    name?: string
    catalog_id?: string
    api_key?: string
    base_url?: string
  }) => {
    try {
      const { instance } = await api.updateProviderInstance(id, payload)
      await loadInstances()
      return instance
    } catch (e) {
      setError((e as Error).message)
      return null
    }
  }, [loadInstances])

  const deleteInstanceFn = useCallback(async (id: string) => {
    try {
      await api.deleteProviderInstance(id)
      await loadInstances()
      return true
    } catch (e) {
      setError((e as Error).message)
      return false
    }
  }, [loadInstances])

  const listSessions = useCallback(async () => {
    await listSessionsInternal()
  }, [])

  const createSession = useCallback(
    async (instanceId?: string, model?: string) => {
      const { session } = await api.createIngestSession()
      if (instanceId && model) {
        try {
          await api.updateIngestSession(session.id, { instance_id: instanceId, model })
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
      pollGenerationRef.current += 1
      setSessionId(id)
      setActiveSessionId(id)
      localStorage.setItem(SESSION_STORAGE_KEY, id)
      await loadSessionMessagesAndWatch(id)
      try {
        const { session } = await api.getIngestSession(id)
        if (session.llm_instance_id) {
          // Find the instance to get its catalog_id for loading models
          const inst = instances.find((i) => i.id === session.llm_instance_id)
          if (inst) {
            await loadModels(inst.catalog_id)
          }
        }
      } catch {
        // non-critical
      }
    },
    [loadSessionMessagesAndWatch, loadModels, instances],
  )

  const deleteSession = useCallback(
    async (id: string) => {
      const wasActive = sessionId === id || activeSessionId === id
      await api.deleteIngestSession(id)

      if (wasActive) {
        pollGenerationRef.current += 1
        activeStreamRef.current = false
        setSessionBusy(false)
        setSessionMessages([])
        setSessionError(null)
        setSessionId(null)
        setActiveSessionId(null)
        localStorage.removeItem(SESSION_STORAGE_KEY)
      }

      const { sessions: remaining } = await api.listIngestSessions()
      setSessions(remaining)

      if (wasActive) {
        const next = remaining.find((s) => s.status === "active")
        if (next) {
          setSessionId(next.id)
          setActiveSessionId(next.id)
          localStorage.setItem(SESSION_STORAGE_KEY, next.id)
          await loadSessionMessagesAndWatch(next.id)
        } else {
          const instanceId = settings?.last_instance_id
          const model = settings?.last_model
          const { session } = await api.createIngestSession()
          setSessionId(session.id)
          setActiveSessionId(session.id)
          localStorage.setItem(SESSION_STORAGE_KEY, session.id)
          setSessionMessages([])
          if (instanceId && model) {
            try {
              await api.updateIngestSession(session.id, {
                instance_id: instanceId,
                model,
              })
            } catch {
              // non-critical
            }
          }
          const { sessions: updated } = await api.listIngestSessions()
          setSessions(updated)
        }
      }
    },
    [
      sessionId,
      activeSessionId,
      loadSessionMessagesAndWatch,
      settings,
    ],
  )

  const updateSessionLLM = useCallback(
    async (id: string, instanceId: string, model: string) => {
      await api.updateIngestSession(id, { instance_id: instanceId, model })
      await api.updateLastModel(instanceId, model)
      setSettings((prev) =>
        prev ? { ...prev, last_instance_id: instanceId, last_model: model } : prev,
      )
      await listSessionsInternal()
    },
    [],
  )

  const updateLastModelFn = useCallback(
    async (instanceId: string, model: string) => {
      await api.updateLastModel(instanceId, model)
      setSettings((prev) =>
        prev ? { ...prev, last_instance_id: instanceId, last_model: model } : prev,
      )
    },
    [],
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
        instances,
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
        loadInstances,
        createInstance: createInstanceFn,
        updateInstance: updateInstanceFn,
        deleteInstance: deleteInstanceFn,
        listSessions,
        createSession,
        switchSession,
        deleteSession,
        updateSessionLLM,
        updateLastModel: updateLastModelFn,
        toastMessage,
        showToast,
        dismissToast,
      }}
    >
      {children}
      <Toast message={toastMessage} onClose={dismissToast} />
    </AppContext.Provider>
  )
}

export function useApp(): AppState {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error("useApp must be used within AppProvider")
  return ctx
}
