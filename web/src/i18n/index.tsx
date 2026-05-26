import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from "react"
import zh, { type MessageKey } from "./messages/zh"
import en from "./messages/en"
import { getSettings } from "@/lib/api"

export type { MessageKey }

type Lang = "zh" | "en"

export type TranslateParams = Record<string, string | number>

const messages: Record<Lang, Record<MessageKey, string>> = { zh, en }

const DEFAULT_LANG: Lang = "zh"

let currentLang: Lang = DEFAULT_LANG

export function getCurrentLang(): Lang {
  return currentLang
}

function interpolate(text: string, params?: TranslateParams): string {
  if (!params) return text
  return Object.entries(params).reduce(
    (acc, [key, value]) =>
      acc.replace(new RegExp(`\\{${key}\\}`, "g"), String(value)),
    text,
  )
}

export function translate(
  lang: Lang,
  key: MessageKey,
  params?: TranslateParams,
): string {
  const text = messages[lang][key] ?? key
  return interpolate(text, params)
}

interface I18nContextValue {
  lang: Lang
  setLang: (lang: Lang) => void
  t: (key: MessageKey, params?: TranslateParams) => string
}

const I18nContext = createContext<I18nContextValue>({
  lang: DEFAULT_LANG,
  setLang: () => {},
  t: (key, params) => translate(DEFAULT_LANG, key, params),
})

export function I18nProvider({
  children,
  initialLang,
  bootstrapFromSettings = true,
  onLangChange,
}: {
  children: ReactNode
  initialLang?: Lang
  bootstrapFromSettings?: boolean
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
    (key: MessageKey, params?: TranslateParams): string => {
      return translate(lang, key, params)
    },
    [lang],
  )

  useEffect(() => {
    currentLang = lang
  }, [lang])

  useEffect(() => {
    if (initialLang && initialLang !== lang) {
      setLangState(initialLang)
    }
  }, [initialLang])

  useEffect(() => {
    if (!bootstrapFromSettings) return
    void getSettings()
      .then((settings) => {
        const uiLang = settings.ui_language
        if (uiLang === "zh" || uiLang === "en") {
          setLangState(uiLang)
        }
      })
      .catch(() => {
        // keep default
      })
  }, [bootstrapFromSettings])

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
