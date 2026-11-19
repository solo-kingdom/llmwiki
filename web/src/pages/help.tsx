import * as React from "react"
import { Markdown } from "@/components/blocks/markdown"
import { useUrlState } from "@/components/blocks/router"
import { Body, Page, Panel, Row, Rows, Split } from "@/components/blocks/surfaces"
import { useContainerWidth } from "@/components/blocks/use-container-width"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import zhContent from "@/content/help.zh.md?raw"
import enContent from "@/content/help.en.md?raw"

type Section = { id: string; text: string }

function slugify(text: string): string {
  return text.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "")
}

function sectionsOf(content: string): Section[] {
  return content
    .split("\n")
    .map((line) => /^##\s+(.+?)\s*$/.exec(line))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => {
      const text = (match[1] ?? "").trim()
      return { id: slugify(text), text }
    })
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

function HelpBody({ content, activeLang, setLang }: {
  content: string
  activeLang: string
  setLang: (value: string) => void
}) {
  return (
    <Body width="reading">
      <Tabs value={activeLang} onValueChange={setLang}>
        <TabsList variant="line">
          <TabsTrigger value="zh">简体中文</TabsTrigger>
          <TabsTrigger value="en">English</TabsTrigger>
        </TabsList>
      </Tabs>
      <Panel>
        <Document content={content} />
      </Panel>
    </Body>
  )
}

export function HelpPage() {
  const [lang, setLang] = useUrlState("lang", "zh")
  const activeLang = lang === "en" ? "en" : "zh"
  const content = activeLang === "zh" ? zhContent : enContent
  const sections = React.useMemo(() => sectionsOf(content), [content])
  const [ref, width] = useContainerWidth<HTMLDivElement>()
  const compact = width > 0 && width < 720
  const [sectionId, setSectionId] = React.useState(sections[0]?.id ?? "")

  const jumpTo = (id: string) => {
    setSectionId(id)
    requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }))
  }

  return (
    <Page title="帮助" actions={[]} layout="fill">
      <div ref={ref} className="flex min-h-0 min-w-0 flex-1 flex-col">
        {compact ? (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <Body width="reading">
              <Select value={sectionId} onValueChange={jumpTo}>
                <SelectTrigger aria-label="选择章节"><SelectValue placeholder="选择章节" /></SelectTrigger>
                <SelectContent>
                  {sections.map((section) => <SelectItem key={section.id} value={section.id}>{section.text}</SelectItem>)}
                </SelectContent>
              </Select>
            </Body>
            <HelpBody content={content} activeLang={activeLang} setLang={setLang} />
          </div>
        ) : (
          <Split
            sideLabel="文档目录"
            sideWidth="sm"
            side={
              <Panel padding="none">
                <Rows label="文档目录">
                  {sections.map((section) => (
                    <Row key={section.id}>
                      <button
                        type="button"
                        className="min-w-0 flex-1 truncate text-left text-sm hover:underline"
                        onClick={() => jumpTo(section.id)}
                      >
                        {section.text}
                      </button>
                    </Row>
                  ))}
                </Rows>
              </Panel>
            }
          >
            <div className="min-h-0 flex-1 overflow-y-auto">
              <HelpBody content={content} activeLang={activeLang} setLang={setLang} />
            </div>
          </Split>
        )}
      </div>
    </Page>
  )
}
