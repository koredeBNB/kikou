import { MODEL_IDS, MODEL_LABELS, type AnswerSource, type ModelId } from "@/lib/sov/types";

export type Env = Record<string, string | undefined>;

export interface LiveSetting {
  live: true;
  apiKey: string;
  modelName: string;
  webSearch: boolean;
}

export type ProviderSetting = LiveSetting | { live: false };

interface ProviderDefinition {
  keys: string[];
  modelVar: string;
  defaultModel: string;
  webSearchVar: string;
  webSearchDefault: boolean;
}

export const PROVIDERS: Record<ModelId, ProviderDefinition> = {
  chatgpt: {
    keys: ["OPENAI_API_KEY"],
    modelVar: "OPENAI_MODEL",
    defaultModel: "gpt-4.1-mini",
    webSearchVar: "OPENAI_WEB_SEARCH",
    webSearchDefault: false,
  },
  claude: {
    keys: ["ANTHROPIC_API_KEY"],
    modelVar: "ANTHROPIC_MODEL",
    defaultModel: "claude-haiku-4-5",
    webSearchVar: "ANTHROPIC_WEB_SEARCH",
    webSearchDefault: false,
  },
  gemini: {
    keys: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
    modelVar: "GEMINI_MODEL",
    defaultModel: "gemini-2.5-flash",
    webSearchVar: "GEMINI_WEB_SEARCH",
    webSearchDefault: false,
  },
  perplexity: {
    keys: ["PERPLEXITY_API_KEY"],
    modelVar: "PERPLEXITY_MODEL",
    defaultModel: "sonar",
    webSearchVar: "",
    webSearchDefault: true,
  },
};

export const truthy = (value: string | undefined) => /^(1|true|yes|on)$/i.test(value?.trim() ?? "");

export function resolveProviders(env: Env): Record<ModelId, ProviderSetting> {
  const forceMock = truthy(env.SOV_FORCE_MOCK);
  return Object.fromEntries(
    MODEL_IDS.map((id): [ModelId, ProviderSetting] => {
      const def = PROVIDERS[id];
      const apiKey = def.keys.map((k) => env[k]?.trim()).find(Boolean);
      if (forceMock || !apiKey) return [id, { live: false }];
      const searchFlag = def.webSearchVar ? env[def.webSearchVar] : undefined;
      return [
        id,
        {
          live: true,
          apiKey,
          modelName: env[def.modelVar]?.trim() || def.defaultModel,
          webSearch: searchFlag === undefined ? def.webSearchDefault : truthy(searchFlag),
        },
      ];
    }),
  ) as Record<ModelId, ProviderSetting>;
}

export interface ProviderStatus {
  id: ModelId;
  label: string;
  source: AnswerSource;
  modelName?: string;
}

export function providerStatus(env: Env): ProviderStatus[] {
  const providers = resolveProviders(env);
  return MODEL_IDS.map((id) => {
    const setting = providers[id];
    return setting.live
      ? { id, label: MODEL_LABELS[id], source: "live", modelName: setting.modelName }
      : { id, label: MODEL_LABELS[id], source: "mock" };
  });
}
