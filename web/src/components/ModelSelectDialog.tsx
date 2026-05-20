import { useEffect, useMemo, useState } from "react"
import { Dialog } from "@base-ui/react/dialog"
import { Clock, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { ModelInfo, ProviderInstance } from "@/types"
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
  onLoadModels: (catalogId: string) => void
  onConfirm: (instanceId: string, modelId: string) => void
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
  onLoadModels,
  onConfirm,
}: ModelSelectDialogProps) {
  const [draftInstanceId, setDraftInstanceId] = useState(selectedInstanceId)
  const [draftModel, setDraftModel] = useState(selectedModel)

  useEffect(() => {
    if (!open) return
    setDraftInstanceId(selectedInstanceId)
    setDraftModel(selectedModel)
  }, [open, selectedInstanceId, selectedModel])

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
    if (!draftInstanceId || !draftModel) return
    persistRecentModel(draftInstanceId, draftModel)
    onConfirm(draftInstanceId, draftModel)
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
            <Dialog.Title className="text-base font-semibold">选择模型</Dialog.Title>
            <Dialog.Close className="inline-flex items-center justify-center rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <X className="size-4" />
            </Dialog.Close>
          </div>

          {instances.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              请先在 Settings 添加 Provider 实例
            </p>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  Provider 实例
                </label>
                <select
                  value={draftInstanceId}
                  onChange={(e) => handleInstanceChange(e.target.value)}
                  className="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring"
                >
                  <option value="">选择实例</option>
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
                  disabled={!draftInstanceId || models.length === 0}
                  className="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring disabled:opacity-50"
                >
                  <option value="">选择模型</option>
                  {models.map((m) => (
                    <option key={m.model_id} value={m.model_id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>

              {recentModels.length > 0 && (
                <div>
                  <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <Clock className="size-3" />
                    最近常用
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
          )}

          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button
              disabled={!draftInstanceId || !draftModel}
              onClick={handleConfirm}
            >
              确认
            </Button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
