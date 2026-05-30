import { describe, it, expect, vi } from "vitest"
import { screen, fireEvent } from "@testing-library/react"
import { HelpPage } from "@/components/HelpPage"
import { renderWithI18n } from "@/test/i18n"

describe("HelpPage", () => {
  it("renders Chinese help content and TOC", () => {
    renderWithI18n(<HelpPage />, { lang: "zh" })
    expect(screen.getByRole("heading", { name: "帮助", level: 1 })).toBeInTheDocument()
    expect(screen.getByRole("navigation", { name: "目录" })).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "快速开始", level: 2 })).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "核心理念", level: 2 })).toBeInTheDocument()
    expect(screen.getByText(/LLM Wiki 与传统 RAG/)).toBeInTheDocument()
  })

  it("renders English help content when ui language is en", () => {
    renderWithI18n(<HelpPage />, { lang: "en" })
    expect(screen.getByRole("heading", { name: "Help", level: 1 })).toBeInTheDocument()
    expect(screen.getByRole("navigation", { name: "Contents" })).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Quick Start", level: 2 })).toBeInTheDocument()
    expect(screen.getByText(/How LLM Wiki differs from traditional RAG/)).toBeInTheDocument()
  })

  it("renders TOC entries for all sections", () => {
    renderWithI18n(<HelpPage />, { lang: "zh" })
    expect(screen.getByRole("button", { name: "快速开始" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "常见问题" })).toBeInTheDocument()
  })

  it("scrolls to section when TOC entry is clicked", () => {
    const scrollIntoView = vi.fn()
    HTMLElement.prototype.scrollIntoView = scrollIntoView

    renderWithI18n(<HelpPage />, { lang: "zh" })
    fireEvent.click(screen.getByRole("button", { name: "核心理念" }))
    expect(scrollIntoView).toHaveBeenCalled()
  })
})
