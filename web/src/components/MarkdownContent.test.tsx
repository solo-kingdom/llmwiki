import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { MarkdownContent } from "@/components/MarkdownContent"
import type { DocumentListItem } from "@/types"

describe("MarkdownContent", () => {
  it("renders headings with chat-prose variant", () => {
    render(<MarkdownContent variant="chat" content="## Hello Chat" />)
    const heading = screen.getByRole("heading", { level: 2, name: "Hello Chat" })
    expect(heading).toBeInTheDocument()
    expect(heading.closest(".chat-prose")).toBeTruthy()
  })

  it("renders headings with reader variant", () => {
    render(<MarkdownContent variant="reader" content="## Hello Reader" />)
    const heading = screen.getByRole("heading", { level: 2, name: "Hello Reader" })
    expect(heading).toBeInTheDocument()
    expect(heading.closest(".wiki-prose")).toBeTruthy()
  })

  it("renders fenced code blocks", () => {
    render(<MarkdownContent content={"```js\nconst x = 1\n```"} />)
    const code = document.querySelector("pre code.hljs")
    expect(code).toBeTruthy()
    expect(code?.textContent).toContain("const")
    expect(code?.textContent).toContain("x = 1")
  })

  it("wraps tables in a horizontal scroll container", () => {
    render(<MarkdownContent content={"| a | b |\n|---|---|\n| 1 | 2 |"} />)
    expect(
      document.querySelector(".markdown-table-wrap.overflow-x-auto"),
    ).toBeTruthy()
    expect(screen.getByRole("columnheader", { name: "a" })).toBeInTheDocument()
  })

  it("renders index table rows with escaped wikilinks as four columns", () => {
    const documents: DocumentListItem[] = [
      {
        id: "doc-alpha",
        filename: "alpha.md",
        title: "Alpha Entity",
        path: "/wiki/entities",
        file_type: "md",
        page_count: 1,
        updated_at: "",
      },
    ]
    const content = [
      "| 页面 | 标题 | 摘要 | 更新日期 |",
      "|------|------|------|----------|",
      "| [[entities/alpha\\|Alpha Entity]] | Alpha Entity | First entity | 2024-03-01 |",
    ].join("\n")

    render(
      <MarkdownContent
        variant="reader"
        content={content}
        documents={documents}
      />,
    )

    const link = screen.getByRole("link", { name: "Alpha Entity" })
    expect(link).toHaveAttribute("href", "/d/doc-alpha")
    expect(screen.getByRole("columnheader", { name: "页面" })).toBeInTheDocument()
    expect(screen.getByRole("columnheader", { name: "标题" })).toBeInTheDocument()
    expect(screen.getByRole("columnheader", { name: "摘要" })).toBeInTheDocument()
    expect(
      screen.getByRole("columnheader", { name: "更新日期" }),
    ).toBeInTheDocument()
    expect(screen.getByRole("cell", { name: "First entity" })).toBeInTheDocument()
    expect(screen.getByRole("cell", { name: "2024-03-01" })).toBeInTheDocument()
    expect(document.body.textContent).not.toContain("[[")
    expect(document.body.textContent).not.toContain("]]")
  })
})
