/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import {
  filterByPageTypes,
  inferPageType,
  CONCEPT_MODE_TYPES,
  type NavigationMode,
} from "@/lib/wiki-page-types"
import type {
  Document,
  DocumentListItem,
  PublicWikiDocument,
  SearchResponse,
} from "@/types"
import * as api from "@/lib/api"
import { getDocIdFromLocation, notifyPathChange } from "@/lib/wiki-routes"

function publicToDocument(pub: PublicWikiDocument): Document {
  return {
    id: pub.id,
    user_id: "",
    filename: pub.filename,
    title: pub.title,
    path: pub.path,
    relative_path: "",
    source_kind: "",
    file_type: pub.file_type,
    file_size: 0,
    document_number: 0,
    status: "ready",
    page_count: pub.page_count,
    content: pub.content,
    tags: pub.tags ?? [],
    date: "",
    metadata: "",
    error_message: "",
    version: 0,
    parser: "",
    content_hash: "",
    stale_since: "",
    highlights: "",
    created_at: "",
    updated_at: pub.updated_at,
  }
}

interface WikiReaderState {
  documents: DocumentListItem[]
  filteredDocuments: DocumentListItem[]
  navigationMode: NavigationMode
  setNavigationMode: (mode: NavigationMode) => void
  selectedPageTypes: string[]
  setSelectedPageTypes: (types: string[]) => void
  currentDoc: Document | null
  currentDocId: string | null
  searchResults: SearchResponse | null
  searchQuery: string
  loading: boolean
  error: string | null
  publicWikiEnabled: boolean | null
  selectDocument: (id: string) => void
  search: (q: string, types?: string[]) => void
  clearSearch: () => void
  refreshDocuments: () => void
}

const WikiReaderContext = createContext<WikiReaderState | null>(null)

export function WikiReaderProvider({ children }: { children: ReactNode }) {
  const [documents, setDocuments] = useState<DocumentListItem[]>([])
  const [navigationMode, setNavigationMode] = useState<NavigationMode>("concept")
  const [selectedPageTypes, setSelectedPageTypes] = useState<string[]>([])
  const [currentDoc, setCurrentDoc] = useState<Document | null>(null)
  const [currentDocId, setCurrentDocId] = useState<string | null>(null)
  const [searchResults, setSearchResults] = useState<SearchResponse | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [publicWikiEnabled, setPublicWikiEnabled] = useState<boolean | null>(
    null,
  )

  const fetchGeneration = useRef(0)
  const usePublicApi = publicWikiEnabled === true

  const refreshDocuments = useCallback(() => {
    const loader = usePublicApi
      ? api.listPublicDocuments
      : () => api.listDocuments({ source_kind: "wiki", exclude_hidden: true })
    loader()
      .then(setDocuments)
      .catch((e) => setError((e as Error).message))
  }, [usePublicApi])

  const filteredDocuments = useMemo(() => {
    // First, apply navigation mode filter
    const modeFiltered =
      navigationMode === "concept"
        ? documents.filter((d) => {
            const pt = inferPageType(d)
            return (
              CONCEPT_MODE_TYPES.includes(pt) ||
              // Also include docs whose raw page_type is "overview"
              d.page_type === "overview"
            )
          })
        : documents
    // Then, apply user's page type filter
    return filterByPageTypes(modeFiltered, selectedPageTypes)
  }, [documents, navigationMode, selectedPageTypes])

  useEffect(() => {
    api
      .getPublicWikiStatus()
      .then((s) => setPublicWikiEnabled(s.enabled))
      .catch(() => setPublicWikiEnabled(false))
  }, [])

  useEffect(() => {
    if (publicWikiEnabled === null) return
    refreshDocuments()
  }, [publicWikiEnabled, refreshDocuments])

  const selectDocument = useCallback(
    (id: string) => {
      if (id === currentDocId) return
      const gen = ++fetchGeneration.current
      setCurrentDocId(id)
      setCurrentDoc(null)
      setLoading(true)
      setError(null)

      const url = new URL(window.location.href)
      url.pathname = "/wiki"
      url.searchParams.set("doc", id)
      window.history.replaceState(
        null,
        "",
        `${url.pathname}?${url.searchParams.toString()}`,
      )
      notifyPathChange()

      const loadDoc = usePublicApi
        ? api.getPublicDocument(id).then(publicToDocument)
        : api.getDocument(id)

      loadDoc
        .then((doc) => {
          if (gen !== fetchGeneration.current) return
          setCurrentDoc(doc)
        })
        .catch((e) => {
          if (gen !== fetchGeneration.current) return
          setError((e as Error).message)
        })
        .finally(() => {
          if (gen !== fetchGeneration.current) return
          setLoading(false)
        })
    },
    [currentDocId, usePublicApi],
  )

  useEffect(() => {
    if (publicWikiEnabled === null || documents.length === 0) return
    const fromUrl = getDocIdFromLocation(
      window.location.search,
      window.location.pathname,
    )
    if (fromUrl && fromUrl !== currentDocId) {
      selectDocument(fromUrl)
    }
  }, [publicWikiEnabled, documents, currentDocId, selectDocument])

  const search = useCallback(
    (q: string, types?: string[]) => {
      if (!q.trim()) {
        setSearchResults(null)
        setSearchQuery("")
        return
      }
      setSearchQuery(q)
      const searcher = usePublicApi ? api.searchPublicWiki : api.searchDocuments
      searcher(q, 10, types)
        .then(setSearchResults)
        .catch((e) => setError((e as Error).message))
    },
    [usePublicApi],
  )

  const clearSearch = useCallback(() => {
    setSearchResults(null)
    setSearchQuery("")
  }, [])

  return (
    <WikiReaderContext.Provider
      value={{
        documents,
        filteredDocuments,
        navigationMode,
        setNavigationMode,
        selectedPageTypes,
        setSelectedPageTypes,
        currentDoc,
        currentDocId,
        searchResults,
        searchQuery,
        loading,
        error,
        publicWikiEnabled,
        selectDocument,
        search,
        clearSearch,
        refreshDocuments,
      }}
    >
      {children}
    </WikiReaderContext.Provider>
  )
}

export function useWikiReader(): WikiReaderState {
  const ctx = useContext(WikiReaderContext)
  if (!ctx) {
    throw new Error("useWikiReader must be used within WikiReaderProvider")
  }
  return ctx
}
