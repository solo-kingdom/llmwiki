import { useMemo, useRef, type ComponentProps } from "react"
import type { Components } from "react-markdown"
import helpZh from "@/content/help.zh.md?raw"
import helpEn from "@/content/help.en.md?raw"
import { HELP_SECTIONS } from "@/content/help-sections"
import { MarkdownContent } from "@/components/MarkdownContent"
import { PageContainer } from "@/components/PageContainer"
import { useI18n, useT } from "@/i18n"
import { cn } from "@/lib/utils"

const HELP_CONTENT = {
  zh: helpZh,
  en: helpEn,
} as const

export function HelpPage() {
  const { lang } = useI18n()
  const t = useT()
  const content = HELP_CONTENT[lang]
  const sectionIndexRef = useRef(0)
  sectionIndexRef.current = 0

  const markdownComponents = useMemo((): Components => {
    return {
      h2: ({ children, ...props }: ComponentProps<"h2">) => {
        const section = HELP_SECTIONS[sectionIndexRef.current]
        sectionIndexRef.current += 1
        return (
          <h2 id={section?.id} {...props}>
            {children}
          </h2>
        )
      },
    }
  }, [])

  const scrollToSection = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" })
  }

  return (
    <PageContainer>
      <div className="mx-auto max-w-4xl">
        <h1 className="mb-6 text-2xl font-semibold tracking-tight">
          {t("help.title")}
        </h1>
        <div className="flex min-h-0 flex-col gap-8 lg:flex-row lg:items-start">
          <nav
            aria-label={t("help.toc.label")}
            className="lg:sticky lg:top-4 lg:w-44 lg:shrink-0"
          >
            <ul className="flex flex-row flex-wrap gap-2 lg:flex-col lg:gap-1">
              {HELP_SECTIONS.map((section) => (
                <li key={section.id}>
                  <button
                    type="button"
                    onClick={() => scrollToSection(section.id)}
                    className={cn(
                      "rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground transition-colors",
                      "hover:bg-muted/60 hover:text-foreground",
                    )}
                  >
                    {t(section.labelKey)}
                  </button>
                </li>
              ))}
            </ul>
          </nav>
          <div className="min-w-0 flex-1">
            <MarkdownContent content={content} components={markdownComponents} />
          </div>
        </div>
      </div>
    </PageContainer>
  )
}
