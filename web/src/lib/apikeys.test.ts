import { describe, expect, it } from "vitest"
import {
  AGENT_SKILL_INSTALL_CMD,
  agentHandoffText,
  apiKeyCurlExample,
  normalizeApiBase,
} from "./apikeys"

describe("apikeys helpers", () => {
  it("normalizes trailing slashes in apiBase", () => {
    expect(normalizeApiBase("https://wiki.lan///")).toBe("https://wiki.lan")
    expect(normalizeApiBase("  http://127.0.0.1:8080/  ")).toBe("http://127.0.0.1:8080")
  })

  it("builds curl example with Bearer header", () => {
    const cmd = apiKeyCurlExample("https://wiki.lan/", "llmwiki_sk_abc123")
    expect(cmd).toContain("curl https://wiki.lan/api/v1/workspace")
    expect(cmd).toContain("Authorization: Bearer llmwiki_sk_abc123")
  })

  it("builds agent handoff text with skill install cmd, credentials, skill.md pointer, and boundary", () => {
    const text = agentHandoffText("https://wiki.lan/", "llmwiki_sk_testkey")
    expect(text).toContain(AGENT_SKILL_INSTALL_CMD)
    expect(text).toContain("API Base: https://wiki.lan")
    expect(text).toContain("API Key: llmwiki_sk_testkey")
    expect(text).toContain("https://wiki.lan/skill.md")
    expect(text).toContain("https://wiki.lan/api/v1/skills")
    expect(text).toContain("401")
    expect(text).toContain("api-keys")
  })
})
