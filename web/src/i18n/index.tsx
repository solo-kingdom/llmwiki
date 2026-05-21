import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react"
import zh, { type MessageKey } from "./messages/zh"
import en from "./messages/en"

export type { MessageKey }

type Lang = "zh" | "en"

const messages: Record<Lang, Record<MessageKey, string>> = { zh, en }

const DEFAULT_LANG: Lang = "zh"

interface I18nContextValue {
  lang: Lang
  setLang: (lang: Lang) => void
  t: (key: MessageKey) => string
}

const I18nContext = createContext<I18nContextValue>({
  lang: DEFAULT_LANG,
  setLang: () => {},
  t: (key) => zh[key],
})

export function I18nProvider({
  children,
  initialLang,
  onLangChange,
}: {
  children: ReactNode
  initialLang?: Lang
  onLangChange?: (lang: Lang) => void
}) {
  const [lang, setLangState] = useState<Lang>(initialLang ?? DEFAULT_LANG)

  const setLang = useCallback(
    (newLang: Lang) => {
      if (newLang !== "zh" && newLang !== "en") return
      setLangState(newLang)
      onLangChange?.(newLang)
    },
    [onLangChange],
  )

  const t = useCallback(
    (key: MessageKey): string => {
      return messages[lang][key] ?? key
    },
    [lang],
  )

  useEffect(() => {
    if (initialLang && initialLang !== lang) {
      setLangState(initialLang)
    }
  }, [initialLang])

  return (
    <I18nContext.Provider value={{ lang, setLang, t }}>
      {children}
    </I18nContext.Provider>
  )
}

export function useI18n() {
  return useContext(I18nContext)
}

export function useT() {
  return useContext(I18nContext).t
}
