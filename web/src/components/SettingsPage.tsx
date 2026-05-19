import { useEffect, useState, useMemo, type FormEvent } from "react"
import { useApp } from "@/context/AppContext"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import type { Settings } from "@/types"

const PROVIDERS = ["openai", "anthropic", "ollama", "custom"] as const

export function SettingsPage() {
  const { settings, loadSettings, saveSettings } = useApp()
  const [form, setForm] = useState<Partial<Settings> | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    loadSettings()
  }, [loadSettings])

  const mergedForm = useMemo(() => {
    if (form) return form
    return settings ?? ({} as Partial<Settings>)
  }, [form, settings])

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setSaved(false)
    try {
      await saveSettings(mergedForm)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch {
      // error handled by context
    } finally {
      setSaving(false)
    }
  }

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    setForm((prev) => ({ ...(prev ?? settings ?? {}), [key]: value }))

  return (
    <div className="flex-1 overflow-auto p-6">
      <h1 className="text-xl font-semibold mb-6">Settings</h1>
      <form onSubmit={handleSubmit} className="max-w-xl space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>LLM Configuration</CardTitle>
            <CardDescription>
              Configure the language model provider and credentials.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-sm font-medium">Provider</label>
              <select
                value={mergedForm.llm_provider || ""}
                onChange={(e) => set("llm_provider", e.target.value)}
                className="mt-1 flex h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring"
              >
                {PROVIDERS.map((p) => (
                  <option key={p} value={p}>
                    {p.charAt(0).toUpperCase() + p.slice(1)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-sm font-medium">Model</label>
              <Input
                value={mergedForm.llm_model || ""}
                onChange={(e) => set("llm_model", e.target.value)}
                placeholder="gpt-4"
                className="mt-1"
              />
            </div>
            <div>
              <label className="text-sm font-medium">API Key</label>
              <Input
                type="password"
                value={mergedForm.api_key || ""}
                onChange={(e) => set("api_key", e.target.value)}
                placeholder="sk-..."
                className="mt-1"
              />
              {mergedForm.api_key === "****" && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Key is set. Enter a new value to change it.
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Processing</CardTitle>
            <CardDescription>
              Chunk size, overlap, and indexing behavior.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium">Max Tokens</label>
                <Input
                  type="number"
                  value={mergedForm.max_tokens || ""}
                  onChange={(e) =>
                    set("max_tokens", parseInt(e.target.value) || 0)
                  }
                  className="mt-1"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Temperature</label>
                <Input
                  type="number"
                  step="0.1"
                  value={mergedForm.temperature || ""}
                  onChange={(e) =>
                    set("temperature", parseFloat(e.target.value) || 0)
                  }
                  className="mt-1"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium">Chunk Size</label>
                <Input
                  type="number"
                  value={mergedForm.chunk_size || ""}
                  onChange={(e) =>
                    set("chunk_size", parseInt(e.target.value) || 0)
                  }
                  className="mt-1"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Chunk Overlap</label>
                <Input
                  type="number"
                  value={mergedForm.chunk_overlap || ""}
                  onChange={(e) =>
                    set("chunk_overlap", parseInt(e.target.value) || 0)
                  }
                  className="mt-1"
                />
              </div>
            </div>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={mergedForm.auto_reindex ?? true}
                  onChange={(e) => set("auto_reindex", e.target.checked)}
                  className="rounded"
                />
                Auto Reindex
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={mergedForm.watch_sources ?? true}
                  onChange={(e) => set("watch_sources", e.target.checked)}
                  className="rounded"
                />
                Watch Sources
              </label>
            </div>
          </CardContent>
        </Card>

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={saving}>
            {saving ? "Saving..." : "Save Settings"}
          </Button>
          {saved && (
            <span className="text-sm text-green-600">Settings saved</span>
          )}
        </div>
      </form>
    </div>
  )
}
