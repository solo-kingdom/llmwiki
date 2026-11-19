import type { ModelInfo, ProviderInfo } from "../store/types.js";
import { PROVIDERS_SNAPSHOT } from "./providers_snapshot_data.js";

interface SnapshotModel {
  id: string;
  name: string;
  context_limit: number;
  output_limit: number;
  reasoning: boolean;
  tool_call: boolean;
  attachment: boolean;
}

interface SnapshotProvider {
  id: string;
  name: string;
  env: string[];
  api_base: string;
  api_format: string;
  models: Record<string, SnapshotModel>;
}

export function loadSnapshot(): { providers: ProviderInfo[]; models: ModelInfo[] } {
  const providers: ProviderInfo[] = [];
  const models: ModelInfo[] = [];

  for (const raw of Object.values(PROVIDERS_SNAPSHOT as unknown as Record<string, SnapshotProvider>)) {
    const apiFormat = raw.api_format || "openai";
    const envList = raw.env ?? [];
    const envKey = envList.length > 0 ? (envList[0] ?? "") : "";
    providers.push({
      id: raw.id,
      name: raw.name ?? "",
      api_base: raw.api_base ?? "",
      api_format: apiFormat,
      env_key: envKey,
      doc_url: "",
    });
    for (const model of Object.values(raw.models)) {
      models.push({
        provider_id: raw.id,
        model_id: model.id,
        name: model.name,
        family: "",
        context_limit: model.context_limit,
        output_limit: model.output_limit,
        cost_input: 0,
        cost_output: 0,
        reasoning: model.reasoning,
        tool_call: model.tool_call,
        attachment: model.attachment,
        modalities: "{}",
      });
    }
  }
  return { providers, models };
}
