import { useEffect, useMemo, useState } from "react"
import { Dialog } from "@base-ui/react/dialog"
import { Clock, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useT } from "@/i18n"
import type { ACPAgent, AgentKind, ModelInfo, ProviderInstance } from "@/types"
import {
  cn,
  getRecentModels,
  recordRecentModel,
  type RecentModelEntry,
} from "@/lib/utils"

interface ModelSelectDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  instances: ProviderInstance[]
  models: ModelInfo[]
  selectedInstanceId: string
  selectedModel: string
  lastUsedInstanceId?: string
  lastUsedModel?: string
  agentKind: AgentKind
  acpAgentId: string
  acpAgents: ACPAgent[]
  onLoadModels: (catalogId: string) => void
  onConfirm: (runtime: { agentKind: AgentKind; acpAgentId: string; instanceId: string; modelId: string }) => void
}

export function ModelSelectDialog({
  open,
  onOpenChange,
  instances,
  models,
  selectedInstanceId,
  selectedModel,
  lastUsedInstanceId,
  lastUsedModel,
  agentKind,
  acpAgentId,
  acpAgents,
  onLoadModels,
  onConfirm,
}: ModelSelectDialogProps) {
  const t = useT()
  const [draftInstanceId, setDraftInstanceId] = useState(selectedInstanceId)
  const [draftModel, setDraftModel] = useState(selectedModel)
  const [draftAgentKind, setDraftAgentKind] = useState<AgentKind>(agentKind)
  const [draftACPAgentId, setDraftACPAgentId] = useState(acpAgentId)

  useEffect(() => {
    if (!open) return
    setDraftInstanceId(selectedInstanceId)
    setDraftModel(selectedModel)
    setDraftAgentKind(agentKind)
    setDraftACPAgentId(acpAgentId)
  }, [open, selectedInstanceId, selectedModel, agentKind, acpAgentId])

  useEffect(() => {
    if (!open || !draftInstanceId) return
    const inst = instances.find((i) => i.id === draftInstanceId)
    if (inst) onLoadModels(inst.catalog_id)
  }, [open, draftInstanceId, instances, onLoadModels])

  const handleInstanceChange = (instanceId: string) => {
    setDraftInstanceId(instanceId)
    setDraftModel("")
    const inst = instances.find((i) => i.id === instanceId)
    if (inst) onLoadModels(inst.catalog_id)
  }

  const recentModels = useMemo(() => {
    if (!open) return []
    const stored = getRecentModels().filter((entry) =>
      instances.some((inst) => inst.id === entry.instanceId),
    )
    if (stored.length > 0) return stored

    if (
      lastUsedInstanceId &&
      lastUsedModel &&
      instances.some((inst) => inst.id === lastUsedInstanceId)
    ) {
      const inst = instances.find((i) => i.id === lastUsedInstanceId)
      return [
        {
          instanceId: lastUsedInstanceId,
          modelId: lastUsedModel,
          instanceName: inst?.name,
          modelName: lastUsedModel,
        },
      ]
    }

    return []
  }, [open, instances, lastUsedInstanceId, lastUsedModel])

  const persistRecentModel = (instanceId: string, modelId: string) => {
    const inst = instances.find((i) => i.id === instanceId)
    const model = models.find((m) => m.model_id === modelId)
    recordRecentModel({
      instanceId,
      modelId,
      instanceName: inst?.name,
      modelName: model?.name ?? modelId,
    })
  }

  const handleConfirm = () => {
    if (draftAgentKind === "native" && (!draftInstanceId || !draftModel)) return
    if (draftAgentKind === "acp" && !draftACPAgentId) return
    if (draftAgentKind === "native") persistRecentModel(draftInstanceId, draftModel)
    onConfirm({
      agentKind: draftAgentKind,
      acpAgentId: draftAgentKind === "acp" ? draftACPAgentId : "",
      instanceId: draftInstanceId,
      modelId: draftModel,
    })
    onOpenChange(false)
  }

  const handleQuickSelect = (entry: RecentModelEntry) => {
    setDraftInstanceId(entry.instanceId)
    setDraftModel(entry.modelId)
    const inst = instances.find((i) => i.id === entry.instanceId)
    if (inst) onLoadModels(inst.catalog_id)
  }

  const formatRecentLabel = (entry: RecentModelEntry) => {
    const inst =
      instances.find((i) => i.id === entry.instanceId) ??
      (entry.instanceName ? { name: entry.instanceName } : null)
    const instanceLabel = inst?.name ?? entry.instanceId
    const modelLabel = entry.modelName ?? entry.modelId
    return `${instanceLabel} / ${modelLabel}`
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/40 data-[starting-style]:opacity-0 data-[ending-style]:opacity-0 transition-opacity duration-200" />
        <Dialog.Popup className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-background p-6 shadow-lg outline-none data-[starting-style]:scale-95 data-[starting-style]:opacity-0 data-[ending-style]:scale-95 data-[ending-style]:opacity-0 transition-[opacity,scale] duration-200">
          <div className="mb-4 flex items-center justify-between">
            <Dialog.Title className="text-base font-semibold">{t("model.select_title")}</Dialog.Title>
            <Dialog.Close className="inline-flex items-center justify-center rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <X className="size-4" />
            </Dialog.Close>
          </div>

          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                {t("model.runtime.label")}
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  className={cn(
                    "rounded-lg border px-2 py-1.5 text-sm transition-colors",
                    draftAgentKind === "native" ? "border-ring bg-muted" : "border-input",
                  )}
                  onClick={() => setDraftAgentKind("native")}
                >
                  {t("model.runtime.native")}
                </button>
                {acpAgents.filter((agent) => agent.enabled).map((agent) => (
                  <button
                    key={agent.id}
                    type="button"
                    disabled={!agent.available}
                    title={agent.available ? agent.name : agent.unavailable_reason}
                    className={cn(
                      "rounded-lg border px-2 py-1.5 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                      draftAgentKind === "acp" && draftACPAgentId === agent.id
                        ? "border-ring bg-muted"
                        : "border-input",
                    )}
                    onClick={() => {
                      setDraftAgentKind("acp")
                      setDraftACPAgentId(agent.id)
                    }}
                  >
                    {agent.name}
                    {!agent.available && agent.unavailable_reason ? ` — ${agent.unavailable_reason}` : ""}
                  </button>
                ))}
              </div>
            </div>
            {instances.length === 0 && draftAgentKind === "native" && (
              <p className="text-sm text-muted-foreground">{t("model.no_provider")}</p>
            )}
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  {t("model.instance_label")}
                </label>
                <select
                  value={draftInstanceId}
                  disabled={draftAgentKind === "acp"}
                  onChange={(e) => handleInstanceChange(e.target.value)}
                  className="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring"
                >
                  <option value="">{t("model.select_instance")}</option>
                  {instances.map((inst) => (
                    <option key={inst.id} value={inst.id}>
                      {inst.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  Model
                </label>
                <select
                  value={draftModel}
                  onChange={(e) => setDraftModel(e.target.value)}
                  disabled={draftAgentKind === "acp" || !draftInstanceId || models.length === 0}
                  className="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring disabled:opacity-50"
                >
                  <option value="">{t("model.select_model")}</option>
                  {models.map((m) => (
                    <option key={m.model_id} value={m.model_id}>
                      {m.name}
                    </option>
                  ))}
                </select>
                {draftAgentKind === "acp" && (
                  <p className="mt-1 text-xs text-muted-foreground">{t("model.runtime.agent_selects_model")}</p>
                )}
              </div>

              {draftAgentKind === "native" && recentModels.length > 0 && (
                <div>
                  <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <Clock className="size-3" />
                    {t("model.recent")}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {recentModels.map((entry) => (
                      <button
                        key={`${entry.instanceId}:${entry.modelId}`}
                        type="button"
                        title={formatRecentLabel(entry)}
                        className={cn(
                          "max-w-full truncate rounded-lg border border-input bg-muted/40 px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-muted",
                          draftInstanceId === entry.instanceId &&
                            draftModel === entry.modelId &&
                            "border-ring bg-muted",
                        )}
                        onClick={() => handleQuickSelect(entry)}
                      >
                        {formatRecentLabel(entry)}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              disabled={
                draftAgentKind === "native"
                  ? !draftInstanceId || !draftModel
                  : !draftACPAgentId
              }
              onClick={handleConfirm}
            >
              {t("common.confirm")}
            </Button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
