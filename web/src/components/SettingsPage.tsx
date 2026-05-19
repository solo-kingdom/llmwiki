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
import { Key, ExternalLink } from "lucide-react"

export function SettingsPage() {
  const {
    settings,
    loadSettings,
    saveSettings,
    providers,
    loadProviders,
    setProviderKey,
  } = useApp()

  const [form, setForm] = useState<Partial<Settings> | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [providerKeyForms, setProviderKeyForms] = useState<
    Record<string, { apiKey: string; baseURL: string; saving: boolean; saved: boolean }>
  >({})

  useEffect(() => {
    void loadSettings()
    void loadProviders()
  }, [loadSettings, loadProviders])

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

  const getKeyForm = (providerId: string) =>
    providerKeyForms[providerId] ?? { apiKey: "", baseURL: "", saving: false, saved: false }

  const setKeyForm = (
    providerId: string,
    patch: Partial<{ apiKey: string; baseURL: string; saving: boolean; saved: boolean }>,
  ) =>
    setProviderKeyForms((prev) => ({
      ...prev,
      [providerId]: { ...getKeyForm(providerId), ...patch },
    }))

  const handleSaveProviderKey = async (providerId: string) => {
    const kf = getKeyForm(providerId)
    if (!kf.apiKey) return
    setKeyForm(providerId, { saving: true, saved: false })
    try {
      await setProviderKey(providerId, kf.apiKey, kf.baseURL || undefined)
      setKeyForm(providerId, { saving: false, saved: true, apiKey: "", baseURL: "" })
      setTimeout(() => setKeyForm(providerId, { saved: false }), 2000)
    } catch {
      setKeyForm(providerId, { saving: false })
    }
  }

  return (
    <div className="flex-1 overflow-auto p-6">
      <h1 className="text-xl font-semibold mb-6">Settings</h1>
      <form onSubmit={handleSubmit} className="max-w-xl space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Provider Keys</CardTitle>
            <CardDescription>
              Configure API keys per provider. Keys are stored securely on the server.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {providers.map((p) => {
              const keyStatus = settings?.provider_keys?.[p.id]
              const hasKey = keyStatus?.has_key ?? false
              const kf = getKeyForm(p.id)
              return (
                <div key={p.id} className="space-y-2 border rounded-lg p-3">
                  <div className="flex items-center gap-2">
                    <Key className="size-4 text-muted-foreground" />
                    <span className="text-sm font-medium">{p.name}</span>
                    {hasKey && (
                      <span className="text-xs text-muted-foreground">
                        ({keyStatus?.masked})
                      </span>
                    )}
                    {!hasKey && (
                      <span className="text-xs text-amber-600">No key set</span>
                    )}
                    {p.doc_url && (
                      <a
                        href={p.doc_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ml-auto text-xs text-primary hover:underline inline-flex items-center gap-0.5"
                      >
                        Docs <ExternalLink className="size-3" />
                      </a>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      type="password"
                      placeholder={hasKey ? "Enter new key to replace" : "sk-..."}
                      value={kf.apiKey}
                      onChange={(e) => setKeyForm(p.id, { apiKey: e.target.value })}
                      className="flex-1 h-7 text-sm"
                    />
                    <Input
                      placeholder="Custom base URL (optional)"
                      value={kf.baseURL}
                      onChange={(e) => setKeyForm(p.id, { baseURL: e.target.value })}
                      className="flex-1 h-7 text-sm"
                    />
                    <Button
                      size="sm"
                      disabled={!kf.apiKey || kf.saving}
                      onClick={() => void handleSaveProviderKey(p.id)}
                    >
                      {kf.saving ? "Saving..." : "Save Key"}
                    </Button>
                  </div>
                  {kf.saved && (
                    <p className="text-xs text-green-600">Key saved</p>
                  )}
                </div>
              )
            })}
            {providers.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Loading providers...
              </p>
            )}
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
