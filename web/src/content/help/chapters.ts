import cliEn from "./cli.en.md?raw"
import cliZh from "./cli.zh.md?raw"
import conceptsEn from "./concepts.en.md?raw"
import conceptsZh from "./concepts.zh.md?raw"
import faqEn from "./faq.en.md?raw"
import faqZh from "./faq.zh.md?raw"
import healthEn from "./health.en.md?raw"
import healthZh from "./health.zh.md?raw"
import layoutEn from "./layout.en.md?raw"
import layoutZh from "./layout.zh.md?raw"
import mcpEn from "./mcp.en.md?raw"
import mcpZh from "./mcp.zh.md?raw"
import organizationEn from "./organization.en.md?raw"
import organizationZh from "./organization.zh.md?raw"
import sessionEn from "./session.en.md?raw"
import sessionZh from "./session.zh.md?raw"
import startEn from "./start.en.md?raw"
import startZh from "./start.zh.md?raw"
import webEn from "./web.en.md?raw"
import webZh from "./web.zh.md?raw"
import workflowsEn from "./workflows.en.md?raw"
import workflowsZh from "./workflows.zh.md?raw"

export type HelpChapter = {
  id: string
  zh: string
  en: string
}

/** Chapter order is the help nav order. zh and en files for one id stay paired. */
export const helpChapters: HelpChapter[] = [
  { id: "start", zh: startZh, en: startEn },
  { id: "concepts", zh: conceptsZh, en: conceptsEn },
  { id: "layout", zh: layoutZh, en: layoutEn },
  { id: "organization", zh: organizationZh, en: organizationEn },
  { id: "web", zh: webZh, en: webEn },
  { id: "session", zh: sessionZh, en: sessionEn },
  { id: "health", zh: healthZh, en: healthEn },
  { id: "workflows", zh: workflowsZh, en: workflowsEn },
  { id: "cli", zh: cliZh, en: cliEn },
  { id: "mcp", zh: mcpZh, en: mcpEn },
  { id: "faq", zh: faqZh, en: faqEn },
]

export function helpChapterTitle(markdown: string): string {
  return /^##\s+(.+?)\s*$/m.exec(markdown)?.[1]?.trim() ?? ""
}
