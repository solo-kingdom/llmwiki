import type { MessageKey } from "@/i18n"

export type HelpSection = {
  id: string
  labelKey: MessageKey
}

/** Section order must match h2 heading order in help.zh.md / help.en.md */
export const HELP_SECTIONS: HelpSection[] = [
  { id: "quick-start", labelKey: "help.toc.quick_start" },
  { id: "core-concepts", labelKey: "help.toc.core_concepts" },
  { id: "workspace", labelKey: "help.toc.workspace" },
  { id: "wiki-organization", labelKey: "help.toc.wiki_organization" },
  { id: "web-ui", labelKey: "help.toc.web_ui" },
  { id: "cli", labelKey: "help.toc.cli" },
  { id: "mcp", labelKey: "help.toc.mcp" },
  { id: "faq", labelKey: "help.toc.faq" },
]
