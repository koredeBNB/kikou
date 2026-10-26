import { MODEL_IDS, MODEL_LABELS, type AnswerSource, type ModelId } from "@/lib/sov/types";

export type Env = Record<string, string | undefined>;

export interface LiveSetting {
  live: true;
  apiKey: string;
  modelName: string;
  webSearch: boolean;
  /** Set when the assistant runs through OpenRouter instead of its own API. */
  via?: "openrouter";
  baseUrl?: string;
}

export type ProviderSetting = LiveSetting | { live: false };

export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

interface ProviderDefinition {
  keys: string[];
  modelVar: string;
  defaultModel: string;
  webSearchVar: string;
  webSearchDefault: boolean;
  /** Used when the direct key is missing but OPENROUTER_API_KEY is set. */
  openRouterModelVar: string;
  openRouterModel: string;
}

export const PROVIDERS: Record<ModelId, ProviderDefinition> = {
  chatgpt: {
    keys: ["OPENAI_API_KEY"],
    modelVar: "OPENAI_MODEL",
    defaultModel: "gpt-4.1-mini",
    webSearchVar: "OPENAI_WEB_SEARCH",
    webSearchDefault: false,
    openRouterModelVar: "OPENROUTER_CHATGPT_MODEL",
    openRouterModel: "openai/gpt-6-luna",
  },
  claude: {
    keys: ["ANTHROPIC_API_KEY"],
    modelVar: "ANTHROPIC_MODEL",
    defaultModel: "claude-haiku-4-5",
    webSearchVar: "ANTHROPIC_WEB_SEARCH",
    webSearchDefault: false,
    openRouterModelVar: "OPENROUTER_CLAUDE_MODEL",
    openRouterModel: "anthropic/claude-haiku-5.5",
  },
  gemini: {
    keys: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
    modelVar: "GEMINI_MODEL",
    defaultModel: "gemini-2.5-flash",
    webSearchVar: "GEMINI_WEB_SEARCH",
    webSearchDefault: false,
    openRouterModelVar: "OPENROUTER_GEMINI_MODEL",
    openRouterModel: "google/gemini-3.1-flash-lite",
  },
  perplexity: {
    keys: ["PERPLEXITY_API_KEY"],
    modelVar: "PERPLEXITY_MODEL",
    defaultModel: "sonar",
    webSearchVar: "",
    webSearchDefault: true,
    openRouterModelVar: "OPENROUTER_PERPLEXITY_MODEL",
    openRouterModel: "perplexity/sonar",
  },
};

export const truthy = (value: string | undefined) => /^(1|true|yes|on)$/i.test(value?.trim() ?? "");

export function resolveProviders(env: Env): Record<ModelId, ProviderSetting> {
  const forceMock = truthy(env.SOV_FORCE_MOCK);
  const openRouterKey = env.OPENROUTER_API_KEY?.trim();
  return Object.fromEntries(
    MODEL_IDS.map((id): [ModelId, ProviderSetting] => {
      const def = PROVIDERS[id];
      const apiKey = def.keys.map((k) => env[k]?.trim()).find(Boolean);
      if (forceMock || (!apiKey && !openRouterKey)) return [id, { live: false }];
      const searchFlag = def.webSearchVar ? env[def.webSearchVar] : undefined;
      const webSearch = searchFlag === undefined ? def.webSearchDefault : truthy(searchFlag);
      if (apiKey) return [id, { live: true, apiKey, modelName: env[def.modelVar]?.trim() || def.defaultModel, webSearch }];
      return [
        id,
        {
          live: true,
          via: "openrouter",
          apiKey: openRouterKey as string,
          modelName: env[def.openRouterModelVar]?.trim() || def.openRouterModel,
          webSearch,
          baseUrl: env.OPENROUTER_BASE_URL?.trim() || OPENROUTER_BASE_URL,
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
  via?: "openrouter";
}

export function providerStatus(env: Env): ProviderStatus[] {
  const providers = resolveProviders(env);
  return MODEL_IDS.map((id): ProviderStatus => {
    const setting = providers[id];
    if (!setting.live) return { id, label: MODEL_LABELS[id], source: "mock" };
    const status: ProviderStatus = { id, label: MODEL_LABELS[id], source: "live", modelName: setting.modelName };
    if (setting.via) status.via = setting.via;
    return status;
  });
}
