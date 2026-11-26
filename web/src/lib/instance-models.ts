import type { ProviderInstance } from "@/types"

export const MAX_INSTANCE_MODELS = 64
export const MAX_MODEL_ID_LENGTH = 256

export function mergeModelCandidates(
  catalogIds: readonly string[],
  liveIds: readonly string[],
): string[] {
  const result: string[] = []
  for (const raw of [...catalogIds, ...liveIds]) {
    const id = raw.trim()
    if (id !== "" && !result.includes(id)) result.push(id)
  }
  return result
}

export function normalizeSelectedModels(models: readonly string[]): string[] {
  const result: string[] = []
  for (const raw of models) {
    const id = raw.trim()
    if (id === "" || id.length > MAX_MODEL_ID_LENGTH || result.includes(id)) continue
    result.push(id)
    if (result.length >= MAX_INSTANCE_MODELS) break
  }
  return result
}

export function toggleSelectedModel(
  selected: readonly string[],
  modelId: string,
): string[] {
  const id = modelId.trim()
  if (id === "" || id.length > MAX_MODEL_ID_LENGTH) return [...selected]
  if (selected.includes(id)) {
    return selected.filter((item) => item !== id)
  }
  if (selected.length >= MAX_INSTANCE_MODELS) return [...selected]
  return [...selected, id]
}

export function promoteDefaultModel(
  selected: readonly string[],
  modelId: string,
): string[] {
  const id = modelId.trim()
  if (!selected.includes(id)) return [...selected]
  return [id, ...selected.filter((item) => item !== id)]
}

export function removeSelectedModel(
  selected: readonly string[],
  modelId: string,
): string[] {
  return selected.filter((item) => item !== modelId)
}

export function resolveLinkedModelSelection(
  instances: readonly Pick<ProviderInstance, "id" | "models">[],
  nextInstanceId: string,
  currentModel: string,
): string {
  const target = instances.find((item) => item.id === nextInstanceId)
  if (!target) return ""
  const available = target.models ?? []
  if (available.length === 0) return ""
  return available.includes(currentModel) ? currentModel : (available[0] ?? "")
}
