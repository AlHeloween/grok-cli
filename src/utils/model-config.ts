import { getSettingsManager, UserSettings, ProjectSettings } from './settings-manager.js';

export interface ModelOption {
  model: string;
  contextWindow: string;
  reasoning: boolean;
  recommendedApi: "responses" | "chat";
  webSearchSupport: boolean;
}

export type ModelConfig = string;

// Re-export interfaces for backward compatibility
export { UserSettings, ProjectSettings };

/**
 * Get the effective current model
 * Priority: project current model > user default model > system default
 */
export function getCurrentModel(): string {
  const manager = getSettingsManager();
  return manager.getCurrentModel();
}

/**
 * Load model configuration
 * Priority: user-settings.json models > default hardcoded
 */
export function loadModelConfig(): ModelOption[] {
  const manager = getSettingsManager();
  const models = manager.getAvailableModels();

  return models.map(model => ({
    ...getModelCapabilities(model.trim()),
  }));
}

// Official xAI model data (docs.x.ai/docs/models, Model Pricing table)
const OFFICIAL_MODEL_SPECS: Record<
  string,
  { contextTokens: number; reasoning: boolean }
> = {
  "grok-4-1-fast-reasoning": { contextTokens: 2_000_000, reasoning: true },
  "grok-4-1-fast-non-reasoning": { contextTokens: 2_000_000, reasoning: false },
  "grok-4-fast-reasoning": { contextTokens: 2_000_000, reasoning: true },
  "grok-4-fast-non-reasoning": { contextTokens: 2_000_000, reasoning: false },
  "grok-code-fast-1": { contextTokens: 256_000, reasoning: true },
  "grok-4-0709": { contextTokens: 256_000, reasoning: true },
  "grok-3": { contextTokens: 131_072, reasoning: false },
  "grok-3-mini": { contextTokens: 131_072, reasoning: true },
};

function formatContext(tokens: number): string {
  if (tokens >= 1_000_000) return `${tokens / 1_000_000}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`;
  return String(tokens);
}

export function getModelCapabilities(modelName: string): ModelOption {
  const model = modelName.trim();
  const lowered = model.toLowerCase();

  const exact = OFFICIAL_MODEL_SPECS[model];
  let contextWindow: string;
  let reasoning: boolean;

  if (exact) {
    contextWindow = formatContext(exact.contextTokens);
    reasoning = exact.reasoning;
  } else {
    // Fallback for aliases (e.g. grok-4-latest, grok-3-fast): infer from name
    const isNonReasoning = lowered.includes("non-reasoning");
    reasoning = lowered.includes("reasoning") && !isNonReasoning;
    if (lowered.includes("grok-4-1-fast") || lowered.includes("grok-4-fast")) {
      contextWindow = "2M";
    } else if (
      lowered.includes("grok-4") ||
      lowered.includes("grok-code-fast-1")
    ) {
      contextWindow = "256K";
    } else if (lowered.includes("grok-3")) {
      contextWindow = "131K";
    } else {
      contextWindow = "Unknown";
    }
  }

  const isGrok41Fast = lowered.includes("grok-4-1-fast");
  return {
    model,
    contextWindow,
    reasoning,
    recommendedApi: isGrok41Fast ? "responses" : "chat",
    webSearchSupport: true,
  };
}

/**
 * Get default models list
 */
export function getDefaultModels(): string[] {
  const manager = getSettingsManager();
  return manager.getAvailableModels();
}

/**
 * Update the current model in project settings
 */
export function updateCurrentModel(modelName: string): void {
  const manager = getSettingsManager();
  manager.setCurrentModel(modelName);
}

/**
 * Update the user's default model preference
 */
export function updateDefaultModel(modelName: string): void {
  const manager = getSettingsManager();
  manager.updateUserSetting('defaultModel', modelName);
}
