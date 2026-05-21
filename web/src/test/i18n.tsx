import type { ReactElement, ReactNode } from "react"
import { render, type RenderOptions } from "@testing-library/react"
import { I18nProvider } from "@/i18n"

export function I18nTestProvider({
  children,
  lang = "zh",
}: {
  children: ReactNode
  lang?: "zh" | "en"
}) {
  return (
    <I18nProvider initialLang={lang} bootstrapFromSettings={false}>
      {children}
    </I18nProvider>
  )
}

export function renderWithI18n(
  ui: ReactElement,
  options?: RenderOptions & { lang?: "zh" | "en" },
) {
  const { lang = "zh", ...renderOptions } = options ?? {}
  return render(ui, {
    wrapper: ({ children }) => (
      <I18nTestProvider lang={lang}>{children}</I18nTestProvider>
    ),
    ...renderOptions,
  })
}

export const CJK_PATTERN = /[\u4e00-\u9fff]/
