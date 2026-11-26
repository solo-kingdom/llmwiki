import * as React from "react"
import { Navigate, Outlet, useParams } from "react-router"
import { BookOpenIcon, CircleHelpIcon, FolderTreeIcon, HeartPulseIcon, LightbulbIcon, MessageSquareIcon, MonitorIcon, PlugIcon, TerminalIcon, WorkflowIcon, ZapIcon, type LucideIcon } from "lucide-react"
import { Markdown } from "@/components/blocks/markdown"
import { useUrlState } from "@/components/blocks/router"
import { SectionLayout, type SectionNavItem } from "@/components/blocks/section-nav"
import { Page, Panel, Stack } from "@/components/blocks/surfaces"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { helpChapterTitle, helpChapters } from "@/content/help/chapters"

const CHAPTER_META: Record<string, { icon: LucideIcon; tone: string }> = {
  start: { icon: ZapIcon, tone: "llmwiki-tone-amber" },
  concepts: { icon: LightbulbIcon, tone: "llmwiki-tone-orange" },
  layout: { icon: FolderTreeIcon, tone: "llmwiki-tone-indigo" },
  organization: { icon: BookOpenIcon, tone: "llmwiki-tone-sky" },
  web: { icon: MonitorIcon, tone: "llmwiki-tone-cyan" },
  session: { icon: MessageSquareIcon, tone: "llmwiki-tone-violet" },
  health: { icon: HeartPulseIcon, tone: "llmwiki-tone-emerald" },
  workflows: { icon: WorkflowIcon, tone: "llmwiki-tone-indigo" },
  cli: { icon: TerminalIcon, tone: "llmwiki-tone-slate" },
  mcp: { icon: PlugIcon, tone: "llmwiki-tone-violet" },
  faq: { icon: CircleHelpIcon, tone: "llmwiki-tone-rose" },
}

function slugify(text: string): string {
  return text.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "")
}

function Document({ content }: { content: string }) {
  const ref = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => {
    const root = ref.current
    if (root === null) return
    for (const heading of Array.from(root.querySelectorAll("h2, h3"))) {
      heading.id = slugify(heading.textContent ?? "")
    }
  }, [content])
  return (
    <div ref={ref}>
      <Markdown>{content}</Markdown>
    </div>
  )
}

export function HelpLayout() {
  const [lang, setLang] = useUrlState("lang", "zh")
  const activeLang = lang === "en" ? "en" : "zh"
  const items: SectionNavItem[] = helpChapters.map((chapter) => {
    const meta = CHAPTER_META[chapter.id]
    const Icon = meta?.icon ?? BookOpenIcon
    const markdown = activeLang === "en" ? chapter.en : chapter.zh
    return {
      label: helpChapterTitle(markdown),
      to: `/help/${chapter.id}`,
      icon: <Icon className={meta?.tone ?? "llmwiki-tone-slate"} />,
    }
  })

  return (
    <Page title="帮助" layout="fill">
      <SectionLayout items={items} label="帮助章节" width="reading" keepSearch>
        <Stack gap="md">
          <Tabs value={activeLang} onValueChange={setLang}>
            <TabsList variant="line">
              <TabsTrigger value="zh" style={{ color: "color-mix(in oklab, var(--foreground) 70%, transparent)" }}>简体中文</TabsTrigger>
              <TabsTrigger value="en" style={{ color: "color-mix(in oklab, var(--foreground) 70%, transparent)" }}>English</TabsTrigger>
            </TabsList>
          </Tabs>
          <Outlet />
        </Stack>
      </SectionLayout>
    </Page>
  )
}

export function HelpSection() {
  const { section } = useParams()
  const [lang] = useUrlState("lang", "zh")
  const chapter = helpChapters.find((item) => item.id === section)
  if (chapter === undefined) return <Navigate to="/help/start" replace />
  const content = lang === "en" ? chapter.en : chapter.zh
  return (
    <Panel>
      <Document content={content} />
    </Panel>
  )
}
