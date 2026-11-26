import { describe, expect, it } from "vitest"
import {
  MAX_INSTANCE_MODELS,
  mergeModelCandidates,
  normalizeSelectedModels,
  promoteDefaultModel,
  removeSelectedModel,
  resolveLinkedModelSelection,
  toggleSelectedModel,
} from "./instance-models"

describe("instance-models", () => {
  it("merges catalog and live models without duplicates", () => {
    expect(mergeModelCandidates(["gpt-4o", "o3"], ["o3", "gpt-4.1", " "])).toEqual([
      "gpt-4o",
      "o3",
      "gpt-4.1",
    ])
  })

  it("toggles, promotes, and removes selected models within limit", () => {
    let selected = normalizeSelectedModels(["m1", "m2", "m1"])
    expect(selected).toEqual(["m1", "m2"])
    selected = toggleSelectedModel(selected, "m3")
    expect(selected).toEqual(["m1", "m2", "m3"])
    selected = promoteDefaultModel(selected, "m3")
    expect(selected).toEqual(["m3", "m1", "m2"])
    selected = removeSelectedModel(selected, "m1")
    expect(selected).toEqual(["m3", "m2"])

    const full = Array.from({ length: MAX_INSTANCE_MODELS }, (_, i) => `model-${i}`)
    expect(toggleSelectedModel(full, "extra")).toHaveLength(MAX_INSTANCE_MODELS)
  })

  it("resolves linked model selection when switching provider instances", () => {
    const instances = [
      { id: "inst-a", models: ["gpt-4o", "gpt-4.1"] },
      { id: "inst-b", models: ["deepseek-chat", "gpt-4.1"] },
      { id: "inst-empty", models: [] },
    ]
    expect(resolveLinkedModelSelection(instances, "inst-b", "gpt-4o")).toBe("deepseek-chat")
    expect(resolveLinkedModelSelection(instances, "inst-b", "gpt-4.1")).toBe("gpt-4.1")
    expect(resolveLinkedModelSelection(instances, "inst-empty", "gpt-4o")).toBe("")
  })
})
