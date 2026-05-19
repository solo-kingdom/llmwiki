import { useEffect, useState } from "react"
import { Dialog } from "@base-ui/react/dialog"
import { X } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { ModelInfo, ProviderInstance } from "@/types"

interface ModelSelectDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  instances: ProviderInstance[]
  models: ModelInfo[]
  selectedInstanceId: string
  selectedModel: string
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
    if (!draftInstanceId) return
    const inst = instances.find((i) => i.id === draftInstanceId)
    if (inst) onLoadModels(inst.catalog_id)
  }, [draftInstanceId, instances, onLoadModels])

  const handleInstanceChange = (instanceId: string) => {
    setDraftInstanceId(instanceId)
    setDraftModel("")
    const inst = instances.find((i) => i.id === instanceId)
    if (inst) onLoadModels(inst.catalog_id)
  }

  const handleConfirm = () => {
    if (!draftInstanceId || !draftModel) return
    onConfirm(draftInstanceId, draftModel)
    onOpenChange(false)
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
