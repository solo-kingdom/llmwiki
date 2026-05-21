import { extractFromDocument } from "./extract"
import type { Message } from "./types"

chrome.runtime.onMessage.addListener((message: Message, _sender, sendResponse) => {
  if (message.type !== "EXTRACT_PAGE") {
    return false
  }

  try {
    const extracted = extractFromDocument(document, location.href)
    sendResponse({
      type: "EXTRACTED_PAGE",
      payload: extracted,
    } satisfies Message)
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : "提取失败"
    sendResponse({ type: "EXTRACT_ERROR", error: errMsg } satisfies Message)
  }

  return true
})
