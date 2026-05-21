import { DEFAULT_SERVER_URL, STORAGE_KEY_SERVER_URL } from "./types"

export async function getServerUrl(): Promise<string> {
  const result = await chrome.storage.local.get(STORAGE_KEY_SERVER_URL)
  const value = result[STORAGE_KEY_SERVER_URL]
  if (typeof value === "string" && value.trim()) {
    return value.trim().replace(/\/+$/, "")
  }
  return DEFAULT_SERVER_URL
}

export async function setServerUrl(url: string): Promise<void> {
  await chrome.storage.local.set({
    [STORAGE_KEY_SERVER_URL]: url.trim().replace(/\/+$/, ""),
  })
}
