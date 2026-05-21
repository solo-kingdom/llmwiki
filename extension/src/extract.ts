import TurndownService from "turndown"
import { Readability } from "@mozilla/readability"

function escapeYaml(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
}

export function htmlToMarkdown(html: string): string {
  const turndown = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
  })
  return turndown.turndown(html)
}

export function buildClipContent(title: string, url: string, markdown: string): string {
  const safeTitle = escapeYaml(title)
  const safeUrl = escapeYaml(url)
  return `---
title: "${safeTitle}"
source_url: "${safeUrl}"
---

# ${title}

${markdown.trim()}
`
}

export function extractFromDocument(doc: Document, url: string) {
  const clone = doc.cloneNode(true) as Document
  const reader = new Readability(clone)
  const article = reader.parse()

  if (!article?.content?.trim()) {
    throw new Error("无法提取正文，请尝试其他页面或手动复制内容")
  }

  const title = article.title?.trim() || doc.title?.trim() || "未命名页面"
  const markdown = htmlToMarkdown(article.content)
  const content = buildClipContent(title, url, markdown)

  return { title, url, content }
}

export function webClipFilename(now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\..+$/, "")
  return `web-clip-${stamp}.md`
}
