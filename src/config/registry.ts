import { listThemes } from "../ui/utils/theme.js";
import { loadModelConfig } from "../utils/model-config.js";

export type ConfigScope = "user" | "project";
export type ConfigValueType =
  | "string"
  | "number"
  | "boolean"
  | "secret"
  | "string_list"
  | "object";

export interface ConfigOption {
  value: string;
  label: string;
}

export interface ConfigKeyDef {
  key: string;
  scope: ConfigScope;
  type: ConfigValueType;
  description: string;
  /** Human-friendly grouping used by /config. */
  category: string;
  /** Example/template shown when asking for a value. */
  template?: string;
  /** If set, present a selectable option list (no blank inputs). */
  options?: () => ConfigOption[];
}

export function getConfigRegistry(): ConfigKeyDef[] {
  return [
    {
      key: "user.apiKey",
      scope: "user",
      type: "secret",
      category: "Account",
      description: "Grok API key used for requests.",
      template: "xai-...",
    },
    {
      key: "user.baseURL",
      scope: "user",
      type: "string",
      category: "Account",
      description: "OpenAI-compatible API base URL.",
      options: () => [
        { value: "https://api.x.ai/v1", label: "xAI (default) — https://api.x.ai/v1" },
        { value: "https://api.openai.com/v1", label: "OpenAI — https://api.openai.com/v1" },
        { value: "https://openrouter.ai/api/v1", label: "OpenRouter — https://openrouter.ai/api/v1" },
        { value: "https://api.groq.com/openai/v1", label: "Groq — https://api.groq.com/openai/v1" },
        { value: "__custom__", label: "Custom..." },
      ],
      template: "https://api.x.ai/v1",
    },
    {
      key: "project.model",
      scope: "project",
      type: "string",
      category: "Model",
      description: "Model for this project (overrides user default).",
      options: () =>
        loadModelConfig().map((m) => ({ value: m.model, label: m.model })),
    },
    {
      key: "user.defaultModel",
      scope: "user",
      type: "string",
      category: "Model",
      description: "Default model used when a project does not override it.",
      options: () =>
        loadModelConfig().map((m) => ({ value: m.model, label: m.model })),
    },
    {
      key: "user.maxTokens",
      scope: "user",
      type: "number",
      category: "Model",
      description: "Max output tokens for chat.completions (default 1536).",
      template: "1536",
    },
    {
      key: "user.models",
      scope: "user",
      type: "string_list",
      category: "Model",
      description:
        "Available model IDs shown in /models and used for validation. Provide a comma-separated list.",
      template:
        "grok-code-fast-1, grok-4-latest, grok-3-fast, grok-3-mini-fast",
    },
    {
      key: "user.theme",
      scope: "user",
      type: "string",
      category: "Theme",
      description: "Terminal theme (VS Code-inspired).",
      options: () =>
        listThemes().map((t) => ({
          value: t.id,
          label: `${t.name}  (${t.id})`,
        })),
    },
    {
      key: "project.rag.enabled",
      scope: "project",
      type: "boolean",
      category: "RAG",
      description: "Enable local retrieval (RAG) for this project.",
      options: () => [
        { value: "true", label: "Enabled" },
        { value: "false", label: "Disabled" },
      ],
    },
    {
      key: "project.rag.topK",
      scope: "project",
      type: "number",
      category: "RAG",
      description: "How many chunks to retrieve per request (top-k).",
      template: "6",
    },
    {
      key: "project.rag.embeddings.model",
      scope: "project",
      type: "string",
      category: "RAG",
      description: "Embeddings model override for local RAG (project-level).",
      options: () => [
        { value: "text-embedding-3-small", label: "text-embedding-3-small (default)" },
        { value: "text-embedding-3-large", label: "text-embedding-3-large" },
        { value: "__custom__", label: "Custom..." },
      ],
      template: "text-embedding-3-small",
    },
    {
      key: "project.rag.embeddings.baseURL",
      scope: "project",
      type: "string",
      category: "RAG",
      description:
        "Embeddings base URL override for local RAG (project-level; defaults to user.baseURL when unset).",
      options: () => [
        { value: "__same_as_baseURL__", label: "Same as baseURL (recommended)" },
        { value: "https://api.x.ai/v1", label: "xAI — https://api.x.ai/v1" },
        { value: "https://api.openai.com/v1", label: "OpenAI — https://api.openai.com/v1" },
        { value: "__custom__", label: "Custom..." },
      ],
      template: "https://api.x.ai/v1",
    },
    {
      key: "user.embeddings.model",
      scope: "user",
      type: "string",
      category: "RAG",
      description: "Embeddings model used for local RAG.",
      options: () => [
        { value: "text-embedding-3-small", label: "text-embedding-3-small (default)" },
        { value: "text-embedding-3-large", label: "text-embedding-3-large" },
        { value: "__custom__", label: "Custom..." },
      ],
      template: "text-embedding-3-small",
    },
    {
      key: "user.embeddings.baseURL",
      scope: "user",
      type: "string",
      category: "RAG",
      description: "Embeddings endpoint base URL (defaults to user.baseURL).",
      options: () => [
        { value: "__same_as_baseURL__", label: "Same as baseURL (recommended)" },
        { value: "https://api.x.ai/v1", label: "xAI — https://api.x.ai/v1" },
        { value: "https://api.openai.com/v1", label: "OpenAI — https://api.openai.com/v1" },
        { value: "__custom__", label: "Custom..." },
      ],
      template: "https://api.x.ai/v1",
    },
    {
      key: "user.morphApiKey",
      scope: "user",
      type: "secret",
      category: "Morph",
      description: "Morph API key to enable Morph Fast Apply.",
      template: "morph-...",
    },
  ];
}

export function getConfigCategories(): string[] {
  const cats = new Set(getConfigRegistry().map((d) => d.category));
  return [...cats];
}

export function findConfigKey(key: string): ConfigKeyDef | undefined {
  return getConfigRegistry().find((d) => d.key === key);
}

