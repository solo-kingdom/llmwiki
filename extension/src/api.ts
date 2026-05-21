import { getServerUrl } from "./settings"
import type { ClipPayload, IngestJobResponse } from "./types"

export async function submitTextIngest(payload: ClipPayload): Promise<IngestJobResponse> {
  const baseUrl = await getServerUrl()
  const response = await fetch(`${baseUrl}/api/v1/ingest/jobs/text`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: payload.title,
      content: payload.content,
      filename: payload.filename,
      source_ref: payload.sourceRef,
    }),
  })

  const bodyText = await response.text()
  let body: unknown = {}
  if (bodyText) {
    try {
      body = JSON.parse(bodyText)
    } catch {
      body = { error: bodyText }
    }
  }

  if (!response.ok) {
    const message =
      typeof body === "object" &&
      body !== null &&
      "error" in body &&
      typeof (body as { error: unknown }).error === "string"
        ? (body as { error: string }).error
        : `服务器返回 ${response.status}`
    throw new Error(message)
  }

  return body as IngestJobResponse
}
