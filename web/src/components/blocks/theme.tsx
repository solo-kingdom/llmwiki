/** Light / dark / system theme with persistence; toggles the `.dark` class used by theme.css. */
import * as React from "react"

export type ThemePreference = "light" | "dark" | "system"
type ThemeContextValue = { preference: ThemePreference; resolved: "light" | "dark"; setPreference: (value: ThemePreference) => void }

const read = (key: string): string | null => { try { return window.localStorage.getItem(key) } catch { return null } }
const write = (key: string, value: string): void => { try { window.localStorage.setItem(key, value) } catch { /* storage unavailable */ } }
const ThemeContext = React.createContext<ThemeContextValue | null>(null)

function systemTheme(): "light" | "dark" {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
}

export function ThemeProvider({ children, defaultPreference = "system", storageKey = "ui-theme" }: {
  children: React.ReactNode; defaultPreference?: ThemePreference | undefined; storageKey?: string | undefined
}) {
  const [preference, setPreferenceState] = React.useState<ThemePreference>(() => {
    const stored = typeof window !== "undefined" ? read(storageKey) : null
    return stored === "light" || stored === "dark" || stored === "system" ? stored : defaultPreference
  })
  const [system, setSystem] = React.useState<"light" | "dark">(systemTheme)
  React.useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)")
    const onChange = () => setSystem(media.matches ? "dark" : "light")
    media.addEventListener("change", onChange)
    return () => media.removeEventListener("change", onChange)
  }, [])
  const resolved = preference === "system" ? system : preference
  React.useEffect(() => {
    document.documentElement.classList.toggle("dark", resolved === "dark")
    document.documentElement.style.colorScheme = resolved
  }, [resolved])
  const setPreference = React.useCallback((value: ThemePreference) => {
    write(storageKey, value)
    setPreferenceState(value)
  }, [storageKey])
  const value = React.useMemo(() => ({ preference, resolved, setPreference }), [preference, resolved, setPreference])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const value = React.useContext(ThemeContext)
  if (value === null) throw new Error("useTheme must be used inside <ThemeProvider>")
  return value
}
