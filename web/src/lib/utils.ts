import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

const SEARCH_HISTORY_KEY = "llmwiki-search-history"

export function getSearchHistory(): string[] {
  try {
    const history = localStorage.getItem(SEARCH_HISTORY_KEY)
    return history ? (JSON.parse(history) as string[]) : []
  } catch {
    return []
  }
}

export function saveSearchHistory(query: string): void {
  if (!query.trim()) return
  try {
    let history = getSearchHistory()
    history = history.filter((item) => item.toLowerCase() !== query.toLowerCase())
    history.unshift(query)
    history = history.slice(0, 5)
    localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(history))
  } catch {
    // ignore
  }
}

export function clearSearchHistory(): void {
  try {
    localStorage.removeItem(SEARCH_HISTORY_KEY)
  } catch {
    // ignore
  }
}

export interface RecentModelEntry {
  instanceId: string
  modelId: string
  instanceName?: string
  modelName?: string
}

const RECENT_MODELS_KEY = "llmwiki.recentModels"
const RECENT_MODELS_MAX = 5

export function getRecentModels(): RecentModelEntry[] {
  try {
    const raw = localStorage.getItem(RECENT_MODELS_KEY)
    return raw ? (JSON.parse(raw) as RecentModelEntry[]) : []
  } catch {
    return []
  }
}

export function recordRecentModel(entry: RecentModelEntry): void {
  if (!entry.instanceId || !entry.modelId) return
  try {
    let history = getRecentModels()
    history = history.filter(
      (item) =>
        !(
          item.instanceId === entry.instanceId &&
          item.modelId === entry.modelId
        ),
    )
    history.unshift(entry)
    history = history.slice(0, RECENT_MODELS_MAX)
    localStorage.setItem(RECENT_MODELS_KEY, JSON.stringify(history))
  } catch {
    // ignore
  }
}
