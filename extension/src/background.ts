import { submitTextIngest } from "./api"
import type { Message } from "./types"

chrome.runtime.onMessage.addListener((message: Message, _sender, sendResponse) => {
  if (message.type !== "SUBMIT_CLIP") {
    return false
  }

  submitTextIngest(message.payload)
    .then((result) => {
      sendResponse({ type: "SUBMIT_RESULT", payload: result } satisfies Message)
    })
    .catch((error: unknown) => {
      const errMsg = error instanceof Error ? error.message : "提交失败"
      sendResponse({ type: "SUBMIT_ERROR", error: errMsg } satisfies Message)
    })

  return true
})
