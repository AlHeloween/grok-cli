import { getSettingsManager } from "../utils/settings-manager.js";

export type ConfigSource = "env" | "cli" | "user" | "project" | "default";

export interface EffectiveConfigItem {
  key: string;
  value: unknown;
  source: ConfigSource;
  note?: string;
}

function envString(name: string): string | undefined {
  const v = process.env[name];
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function envNumber(name: string): number | undefined {
  const v = envString(name);
  if (!v) return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export function maskSecret(value: unknown): string {
  if (!value) return "";
  const s = String(value);
  if (s.length <= 6) return "******";
  return `${s.slice(0, 3)}…${s.slice(-3)}`;
}

export function getEffectiveConfig(): EffectiveConfigItem[] {
  const settings = getSettingsManager();
  const user = settings.loadUserSettings();
  const project = settings.loadProjectSettings();

  const apiKeyEnv = envString("GROK_API_KEY");
  const baseUrlEnv = envString("GROK_BASE_URL");
  const themeEnv = envString("GROK_THEME");
  const maxTokensEnv = envNumber("GROK_MAX_TOKENS");
  const morphEnv = envString("MORPH_API_KEY");

  const embeddingsBaseURLEnv = envString("GROK_EMBEDDINGS_BASE_URL");
  const embeddingsModelEnv = envString("GROK_EMBEDDINGS_MODEL");
  const _embeddingsApiKeyEnv = envString("GROK_EMBEDDINGS_API_KEY");

  const apiKey = apiKeyEnv ?? user.apiKey ?? "";
  const baseURL = baseUrlEnv ?? user.baseURL ?? "https://api.x.ai/v1";
  const theme = themeEnv ?? user.theme ?? "vscode-dark-plus";
  const maxTokens =
    maxTokensEnv ?? user.maxTokens ?? 1536;

  const morphApiKey = morphEnv ?? user.morphApiKey ?? "";

  const embeddingsModel =
    embeddingsModelEnv ??
    project.rag?.embeddings?.model ??
    user.embeddings?.model ??
    "text-embedding-3-small";
  const embeddingsBaseURL =
    embeddingsBaseURLEnv ??
    project.rag?.embeddings?.baseURL ??
    user.embeddings?.baseURL ??
    baseURL;
  const _embeddingsApiKey =
    _embeddingsApiKeyEnv ??
    project.rag?.embeddings?.apiKey ??
    user.embeddings?.apiKey ??
    apiKey;

  const embeddingsProvider =
    project.rag?.embeddings?.provider ??
    user.embeddings?.provider ??
    "hash";
  const embeddingsGloveModelPath =
    project.rag?.embeddings?.gloveModelPath ??
    user.embeddings?.gloveModelPath ??
    "data/glove/glove_50d.db";
  const embeddingsHashDimension =
    project.rag?.embeddings?.hashDimension ??
    user.embeddings?.hashDimension ??
    256;
  const userEmbeddingsProvider = user.embeddings?.provider ?? "hash";
  const userEmbeddingsGloveModelPath = user.embeddings?.gloveModelPath ?? "data/glove/glove_50d.db";
  const userEmbeddingsHashDimension = user.embeddings?.hashDimension ?? 256;
  const projectQuantize =
    project.rag?.quantize ?? false;
  const projectQuantizePreload =
    project.rag?.quantizePreload ?? false;
  const userQuantize =
    user.rag?.quantize ?? false;
  const userQuantizePreload =
    user.rag?.quantizePreload ?? false;
  const auroraEnabled =
    project.rag?.aurora?.enabled ?? false;
  const auroraFractalQuantization =
    project.rag?.aurora?.fractalQuantization ?? false;
  const auroraDualQuaternionDistance =
    project.rag?.aurora?.dualQuaternionDistance ?? false;
  const auroraGloveKeywords =
    project.rag?.aurora?.gloveKeywords ?? false;
  const auroraGloveModelPath =
    project.rag?.aurora?.gloveModelPath ?? "data/glove/glove_50d.db";

  const items: EffectiveConfigItem[] = [
    {
      key: "user.apiKey",
      value: apiKey,
      source: apiKeyEnv ? "env" : user.apiKey ? "user" : "default",
      note: apiKey ? "stored/loaded" : "missing",
    },
    {
      key: "user.baseURL",
      value: baseURL,
      source: baseUrlEnv ? "env" : user.baseURL ? "user" : "default",
    },
    {
      key: "project.model",
      value: project.model ?? "",
      source: project.model ? "project" : "default",
    },
    {
      key: "user.defaultModel",
      value: user.defaultModel ?? "",
      source: user.defaultModel ? "user" : "default",
    },
    {
      key: "user.theme",
      value: theme,
      source: themeEnv ? "env" : user.theme ? "user" : "default",
    },
    {
      key: "user.maxTokens",
      value: maxTokens,
      source: maxTokensEnv ? "env" : user.maxTokens ? "user" : "default",
    },
    {
      key: "user.models",
      value: user.models || [],
      source: Array.isArray(user.models) ? "user" : "default",
      note: Array.isArray(user.models) ? `${user.models.length} models` : "default list",
    },
    {
      key: "project.rag.enabled",
      value: !!project.rag?.enabled,
      source: typeof project.rag?.enabled === "boolean" ? "project" : "default",
    },
    {
      key: "project.rag.topK",
      value: project.rag?.topK ?? 6,
      source: typeof project.rag?.topK === "number" ? "project" : "default",
    },
    {
      key: "project.rag.useKMedoids",
      value: !!project.rag?.useKMedoids,
      source: typeof project.rag?.useKMedoids === "boolean" ? "project" : "default",
    },
    {
      key: "project.rag.candidateCount",
      value:
        typeof project.rag?.candidateCount === "number"
          ? project.rag.candidateCount
          : Math.min(50, 3 * (project.rag?.topK ?? 6)),
      source: typeof project.rag?.candidateCount === "number" ? "project" : "default",
      note: "used when k-medoids is enabled",
    },
    {
      key: "project.rag.embeddings.model",
      value: embeddingsModel,
      source: embeddingsModelEnv
        ? "env"
        : project.rag?.embeddings?.model
          ? "project"
          : user.embeddings?.model
            ? "user"
            : "default",
      note: project.rag?.embeddings?.model ? "project override" : undefined,
    },
    {
      key: "project.rag.embeddings.baseURL",
      value: embeddingsBaseURL,
      source: embeddingsBaseURLEnv
        ? "env"
        : project.rag?.embeddings?.baseURL
          ? "project"
          : user.embeddings?.baseURL
            ? "user"
            : "default",
      note: project.rag?.embeddings?.baseURL ? "project override" : undefined,
    },
    {
      key: "user.embeddings.model",
      value: embeddingsModel,
      source: embeddingsModelEnv
        ? "env"
        : project.rag?.embeddings?.model
          ? "project"
          : user.embeddings?.model
            ? "user"
            : "default",
    },
    {
      key: "user.embeddings.baseURL",
      value: embeddingsBaseURL,
      source: embeddingsBaseURLEnv
        ? "env"
        : project.rag?.embeddings?.baseURL
          ? "project"
          : user.embeddings?.baseURL
            ? "user"
            : "default",
    },
    {
      key: "user.morphApiKey",
      value: morphApiKey,
      source: morphEnv ? "env" : user.morphApiKey ? "user" : "default",
      note: morphApiKey ? "stored/loaded" : "not set",
    },
    {
      key: "project.rag.embeddings.provider",
      value: embeddingsProvider,
      source: project.rag?.embeddings?.provider ? "project" : user.embeddings?.provider ? "user" : "default",
    },
    {
      key: "project.rag.embeddings.gloveModelPath",
      value: embeddingsGloveModelPath,
      source: project.rag?.embeddings?.gloveModelPath ? "project" : user.embeddings?.gloveModelPath ? "user" : "default",
    },
    {
      key: "project.rag.embeddings.hashDimension",
      value: embeddingsHashDimension,
      source: project.rag?.embeddings?.hashDimension ? "project" : user.embeddings?.hashDimension ? "user" : "default",
    },
    {
      key: "project.rag.quantize",
      value: projectQuantize,
      source: typeof project.rag?.quantize === "boolean" ? "project" : "default",
    },
    {
      key: "project.rag.quantizePreload",
      value: projectQuantizePreload,
      source: typeof project.rag?.quantizePreload === "boolean" ? "project" : "default",
    },
    {
      key: "user.embeddings.provider",
      value: userEmbeddingsProvider,
      source: user.embeddings?.provider ? "user" : "default",
    },
    {
      key: "user.embeddings.gloveModelPath",
      value: userEmbeddingsGloveModelPath,
      source: user.embeddings?.gloveModelPath ? "user" : "default",
    },
    {
      key: "user.embeddings.hashDimension",
      value: userEmbeddingsHashDimension,
      source: user.embeddings?.hashDimension ? "user" : "default",
    },
    {
      key: "user.rag.quantize",
      value: userQuantize,
      source: typeof user.rag?.quantize === "boolean" ? "user" : "default",
    },
    {
      key: "user.rag.quantizePreload",
      value: userQuantizePreload,
      source: typeof user.rag?.quantizePreload === "boolean" ? "user" : "default",
    },
    {
      key: "project.rag.aurora.enabled",
      value: auroraEnabled,
      source: typeof project.rag?.aurora?.enabled === "boolean" ? "project" : "default",
    },
    {
      key: "project.rag.aurora.fractalQuantization",
      value: auroraFractalQuantization,
      source: typeof project.rag?.aurora?.fractalQuantization === "boolean" ? "project" : "default",
    },
    {
      key: "project.rag.aurora.dualQuaternionDistance",
      value: auroraDualQuaternionDistance,
      source: typeof project.rag?.aurora?.dualQuaternionDistance === "boolean" ? "project" : "default",
    },
    {
      key: "project.rag.aurora.gloveKeywords",
      value: auroraGloveKeywords,
      source: typeof project.rag?.aurora?.gloveKeywords === "boolean" ? "project" : "default",
    },
    {
      key: "project.rag.aurora.gloveModelPath",
      value: auroraGloveModelPath,
      source: project.rag?.aurora?.gloveModelPath ? "project" : "default",
    },
  ];

  return items;
}

