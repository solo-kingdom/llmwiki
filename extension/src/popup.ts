import { webClipFilename } from "./extract"
import { getServerUrl, setServerUrl } from "./settings"
import type { Message } from "./types"

const serverInput = document.getElementById("server-url") as HTMLInputElement
const saveButton = document.getElementById("save-settings") as HTMLButtonElement
const clipButton = document.getElementById("clip-button") as HTMLButtonElement
const statusEl = document.getElementById("status") as HTMLParagraphElement

function setStatus(text: string, kind: "idle" | "loading" | "success" | "error" = "idle") {
  statusEl.textContent = text
  statusEl.className = "popup__status"
  if (kind !== "idle") {
    statusEl.classList.add(`popup__status--${kind}`)
  }
}

function setBusy(busy: boolean) {
  clipButton.disabled = busy
  saveButton.disabled = busy
}

async function loadSettings() {
  serverInput.value = await getServerUrl()
}

saveButton.addEventListener("click", async () => {
  const url = serverInput.value.trim()
  if (!url) {
    setStatus("请输入有效的服务地址", "error")
    return
  }
  await setServerUrl(url)
  setStatus("设置已保存", "success")
})

clipButton.addEventListener("click", async () => {
  setBusy(true)
  setStatus("正在提取正文…", "loading")

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.id) {
      throw new Error("无法获取当前标签页")
    }
    if (!tab.url || tab.url.startsWith("chrome://") || tab.url.startsWith("chrome-extension://")) {
      throw new Error("无法剪藏此类型的页面")
    }

    const extractResponse = (await chrome.tabs.sendMessage(tab.id, {
      type: "EXTRACT_PAGE",
    } satisfies Message)) as Message

    if (extractResponse.type === "EXTRACT_ERROR") {
      throw new Error(extractResponse.error)
    }
    if (extractResponse.type !== "EXTRACTED_PAGE") {
      throw new Error("内容脚本未响应，请刷新页面后重试")
    }

    setStatus("正在提交到 LLM Wiki…", "loading")

    const submitResponse = (await chrome.runtime.sendMessage({
      type: "SUBMIT_CLIP",
      payload: {
        title: extractResponse.payload.title,
        content: extractResponse.payload.content,
        sourceRef: extractResponse.payload.url,
        filename: webClipFilename(),
      },
    } satisfies Message)) as Message

    if (submitResponse.type === "SUBMIT_ERROR") {
      throw new Error(submitResponse.error)
    }
    if (submitResponse.type !== "SUBMIT_RESULT") {
      throw new Error("提交失败，请检查服务是否运行")
    }

    const jobId = submitResponse.payload.job.id
    setStatus(`剪藏成功！任务 ID：${jobId}`, "success")
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "剪藏失败"
    if (message.includes("Could not establish connection")) {
      setStatus("内容脚本未加载，请刷新页面后重试", "error")
    } else if (message.includes("Failed to fetch") || message.includes("NetworkError")) {
      setStatus("无法连接服务器，请检查服务地址与 llmwiki serve", "error")
    } else {
      setStatus(message, "error")
    }
  } finally {
    setBusy(false)
  }
})

void loadSettings()
