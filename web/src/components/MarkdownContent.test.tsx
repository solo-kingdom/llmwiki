import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { MarkdownContent } from "@/components/MarkdownContent"

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
})
