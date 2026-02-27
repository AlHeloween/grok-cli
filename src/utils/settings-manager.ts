import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { MCPServerConfig } from "../mcp/client.js";

/**
 * Current settings version - increment this when adding new models or changing settings structure
 * This triggers automatic migration for existing users
 */
const SETTINGS_VERSION = 3;

/**
 * User-level settings stored in ~/.grok/user-settings.json
 * These are global settings that apply across all projects
 */
export interface UserSettings {
  apiKey?: string; // Grok API key
  baseURL?: string; // API base URL
  defaultModel?: string; // User's preferred default model
  models?: string[]; // Available models list
  theme?: string; // Preferred UI theme id
  maxTokens?: number; // Max output tokens for chat.completions
  embeddings?: EmbeddingsSettings; // Embeddings settings (used by local RAG)
  morphApiKey?: string; // Morph API key (enables Morph Fast Apply)
  settingsVersion?: number; // Version for migration tracking
}

/**
 * Project-level settings stored in .grok/settings.json
 * These are project-specific settings
 */
export interface ProjectSettings {
  model?: string; // Current model for this project
  mcpServers?: Record<string, MCPServerConfig>; // MCP server configurations
  rag?: RagSettings; // Optional RAG (retrieval) settings
}

export interface EmbeddingsSettings {
  baseURL?: string;
  model?: string;
}

export interface RagSettings {
  enabled?: boolean;
  topK?: number;
  embeddings?: EmbeddingsSettings;
  /** If true, select RAG context via k-medoids over a larger candidate set. */
  useKMedoids?: boolean;
  /** Candidate count to retrieve before k-medoids (must be >= topK). */
  candidateCount?: number;
  /** Text extractor used by the RAG indexer (default: native). */
  extractor?: "native" | "sqlite-rag";
  /** Python command used when extractor is sqlite-rag (default: auto-detect). */
  python?: string;
}

/**
 * Default values for user settings
 */
const DEFAULT_USER_SETTINGS: Partial<UserSettings> = {
  baseURL: "https://api.x.ai/v1",
  defaultModel: "grok-code-fast-1",
  theme: "vscode-dark-plus",
  embeddings: {
    model: "text-embedding-3-small",
  },
  // Models from official xAI docs (docs.x.ai/docs/models); aliases -latest/-fast follow docs
  models: [
    "grok-4-1-fast-reasoning",
    "grok-4-1-fast-non-reasoning",
    "grok-4-fast-reasoning",
    "grok-4-fast-non-reasoning",
    "grok-code-fast-1",
    "grok-4-0709",
    "grok-4",
    "grok-4-latest",
    "grok-3",
    "grok-3-mini",
    "grok-3-latest",
    "grok-3-fast",
    "grok-3-mini-fast",
  ],
};

/**
 * Default values for project settings
 */
const DEFAULT_PROJECT_SETTINGS: Partial<ProjectSettings> = {
  model: "grok-code-fast-1",
  rag: {
    enabled: false,
    topK: 6,
    useKMedoids: false,
    candidateCount: 18,
  },
};

/**
 * Unified settings manager that handles both user-level and project-level settings
 */
interface CachedSettings<T> {
  settings: T;
  mtimeMs: number;
}

export class SettingsManager {
  private static instance: SettingsManager;

  private userSettingsPath: string;
  private userSettingsCache: CachedSettings<UserSettings> | null = null;
  private projectSettingsCacheByPath: Map<string, CachedSettings<ProjectSettings>> =
    new Map();

  private constructor() {
    // User settings path: ~/.grok/user-settings.json
    this.userSettingsPath = path.join(
      os.homedir(),
      ".grok",
      "user-settings.json"
    );
  }

  /**
   * Project settings path: .grok/settings.json (in the current working directory).
   * Note: we intentionally derive this dynamically so `cd` at runtime changes the active project.
   */
  private getProjectSettingsPath(cwd: string = process.cwd()): string {
    return path.join(cwd, ".grok", "settings.json");
  }

  /**
   * Project RAG DB path: .grok/rag.db (in the current working directory).
   */
  public getRagDbPath(cwd: string = process.cwd()): string {
    return path.join(cwd, ".grok", "rag.db");
  }

  /**
   * Get singleton instance
   */
  public static getInstance(): SettingsManager {
    if (!SettingsManager.instance) {
      SettingsManager.instance = new SettingsManager();
    }
    return SettingsManager.instance;
  }

  /**
   * Ensure directory exists for a given file path
   */
  private ensureDirectoryExists(filePath: string): void {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
  }

  /**
   * Load user settings from ~/.grok/user-settings.json.
   * Uses in-memory cache when the file mtime is unchanged to avoid repeated disk reads.
   */
  public loadUserSettings(): UserSettings {
    try {
      if (!fs.existsSync(this.userSettingsPath)) {
        const newSettings = { ...DEFAULT_USER_SETTINGS, settingsVersion: SETTINGS_VERSION };
        this.saveUserSettings(newSettings);
        return newSettings;
      }

      const stat = fs.statSync(this.userSettingsPath);
      const mtimeMs = stat.mtimeMs;
      if (this.userSettingsCache && this.userSettingsCache.mtimeMs === mtimeMs) {
        return this.userSettingsCache.settings;
      }

      const content = fs.readFileSync(this.userSettingsPath, "utf-8");
      const settings = JSON.parse(content);

      const currentVersion = settings.settingsVersion || 1;
      let result: UserSettings;
      if (currentVersion < SETTINGS_VERSION) {
        const migratedSettings = this.migrateSettings(settings, currentVersion);
        try {
          this.saveUserSettings(migratedSettings);
        } catch {
          return migratedSettings;
        }
        result = migratedSettings;
        const newStat = fs.statSync(this.userSettingsPath);
        this.userSettingsCache = { settings: result, mtimeMs: newStat.mtimeMs };
        return result;
      }

      result = { ...DEFAULT_USER_SETTINGS, ...settings };
      result.embeddings = {
        ...(DEFAULT_USER_SETTINGS.embeddings || {}),
        ...(settings.embeddings || {}),
      };
      this.userSettingsCache = { settings: result, mtimeMs };
      return result;
    } catch (error) {
      console.warn(
        "Failed to load user settings:",
        error instanceof Error ? error.message : "Unknown error"
      );
      return { ...DEFAULT_USER_SETTINGS };
    }
  }

  /**
   * Migrate settings from an older version to the current version
   */
  private migrateSettings(settings: UserSettings, fromVersion: number): UserSettings {
    const migrated: UserSettings = { ...settings };

    // Migration from version 1 to 2: Add new Grok 4.1 and Grok 4 Fast models
    if (fromVersion < 2) {
      const defaultModels = DEFAULT_USER_SETTINGS.models || [];
      const existingModels = new Set(migrated.models || []);
      
      // Add any new models that don't exist in user's current list
      const newModels = defaultModels.filter(model => !existingModels.has(model));
      
      // Prepend new models to the list (newest models first)
      migrated.models = [...newModels, ...(migrated.models || [])];
    }

    // Migration from version 2 to 3: add embeddings defaults (preserve existing values)
    if (fromVersion < 3) {
      migrated.embeddings = {
        ...(DEFAULT_USER_SETTINGS.embeddings || {}),
        ...(migrated.embeddings || {}),
      };
    }

    // Add future migrations here:
    // if (fromVersion < 3) { ... }

    migrated.settingsVersion = SETTINGS_VERSION;
    return migrated;
  }

  /**
   * Save user settings to ~/.grok/user-settings.json
   */
  public saveUserSettings(settings: Partial<UserSettings>): void {
    try {
      this.ensureDirectoryExists(this.userSettingsPath);

      // Read existing settings directly to avoid recursion
      let existingSettings: UserSettings = { ...DEFAULT_USER_SETTINGS };
      if (fs.existsSync(this.userSettingsPath)) {
        try {
          const content = fs.readFileSync(this.userSettingsPath, "utf-8");
          const parsed = JSON.parse(content);
          existingSettings = { ...DEFAULT_USER_SETTINGS, ...parsed };
          existingSettings.embeddings = {
            ...(DEFAULT_USER_SETTINGS.embeddings || {}),
            ...(parsed.embeddings || {}),
          };
        } catch {
          // If file is corrupted, use defaults
          console.warn("Corrupted user settings file, using defaults");
        }
      }

      const mergedSettings: UserSettings = { ...existingSettings, ...settings };
      if (settings.embeddings) {
        mergedSettings.embeddings = {
          ...(existingSettings.embeddings || {}),
          ...(settings.embeddings || {}),
        };
      }

      fs.writeFileSync(
        this.userSettingsPath,
        JSON.stringify(mergedSettings, null, 2),
        { mode: 0o600 } // Secure permissions for API key
      );
      const stat = fs.statSync(this.userSettingsPath);
      this.userSettingsCache = { settings: mergedSettings as UserSettings, mtimeMs: stat.mtimeMs };
    } catch (error) {
      console.error(
        "Failed to save user settings:",
        error instanceof Error ? error.message : "Unknown error"
      );
      throw error;
    }
  }

  /**
   * Update a specific user setting
   */
  public updateUserSetting<K extends keyof UserSettings>(
    key: K,
    value: UserSettings[K]
  ): void {
    const settings = { [key]: value } as Partial<UserSettings>;
    this.saveUserSettings(settings);
  }

  /**
   * Get a specific user setting
   */
  public getUserSetting<K extends keyof UserSettings>(key: K): UserSettings[K] {
    const settings = this.loadUserSettings();
    return settings[key];
  }

  /**
   * Load project settings from .grok/settings.json.
   * Uses in-memory cache when the file mtime is unchanged.
   */
  public loadProjectSettings(cwd: string = process.cwd()): ProjectSettings {
    try {
      const projectSettingsPath = this.getProjectSettingsPath(cwd);

      if (!fs.existsSync(projectSettingsPath)) {
        this.saveProjectSettings(DEFAULT_PROJECT_SETTINGS, cwd);
        return { ...DEFAULT_PROJECT_SETTINGS };
      }

      const stat = fs.statSync(projectSettingsPath);
      const mtimeMs = stat.mtimeMs;
      const cached = this.projectSettingsCacheByPath.get(projectSettingsPath);
      if (cached && cached.mtimeMs === mtimeMs) {
        return cached.settings;
      }

      const content = fs.readFileSync(projectSettingsPath, "utf-8");
      const settings = JSON.parse(content);
      const result: ProjectSettings = { ...DEFAULT_PROJECT_SETTINGS, ...settings };
      // Ensure nested defaults are preserved when the top-level object exists.
      const rag: RagSettings = {
        ...(DEFAULT_PROJECT_SETTINGS.rag || {}),
        ...(settings.rag || {}),
      };
      result.rag = rag;
      if (settings.rag?.embeddings) {
        rag.embeddings = {
          ...(DEFAULT_PROJECT_SETTINGS.rag?.embeddings || {}),
          ...(settings.rag.embeddings || {}),
        };
      }
      this.projectSettingsCacheByPath.set(projectSettingsPath, {
        settings: result,
        mtimeMs,
      });
      return result;
    } catch (error) {
      console.warn(
        "Failed to load project settings:",
        error instanceof Error ? error.message : "Unknown error"
      );
      return { ...DEFAULT_PROJECT_SETTINGS };
    }
  }

  /**
   * Save project settings to .grok/settings.json
   */
  public saveProjectSettings(
    settings: Partial<ProjectSettings>,
    cwd: string = process.cwd()
  ): void {
    try {
      const projectSettingsPath = this.getProjectSettingsPath(cwd);
      this.ensureDirectoryExists(projectSettingsPath);

      // Read existing settings directly to avoid recursion
      let existingSettings: ProjectSettings = { ...DEFAULT_PROJECT_SETTINGS };
      if (fs.existsSync(projectSettingsPath)) {
        try {
          const content = fs.readFileSync(projectSettingsPath, "utf-8");
          const parsed = JSON.parse(content);
          existingSettings = { ...DEFAULT_PROJECT_SETTINGS, ...parsed };
          const rag: RagSettings = {
            ...(DEFAULT_PROJECT_SETTINGS.rag || {}),
            ...(parsed.rag || {}),
          };
          existingSettings.rag = rag;
          if (parsed.rag?.embeddings) {
            rag.embeddings = {
              ...(DEFAULT_PROJECT_SETTINGS.rag?.embeddings || {}),
              ...(parsed.rag.embeddings || {}),
            };
          }
        } catch {
          // If file is corrupted, use defaults
          console.warn("Corrupted project settings file, using defaults");
        }
      }

      const mergedSettings: ProjectSettings = { ...existingSettings, ...settings };
      if (settings.rag) {
        const rag: RagSettings = {
          ...(existingSettings.rag || {}),
          ...(settings.rag || {}),
        };
        mergedSettings.rag = rag;
        if (settings.rag.embeddings) {
          rag.embeddings = {
            ...(existingSettings.rag?.embeddings || {}),
            ...(settings.rag.embeddings || {}),
          };
        }
      }

      fs.writeFileSync(
        projectSettingsPath,
        JSON.stringify(mergedSettings, null, 2)
      );
      const stat = fs.statSync(projectSettingsPath);
      this.projectSettingsCacheByPath.set(projectSettingsPath, {
        settings: mergedSettings as ProjectSettings,
        mtimeMs: stat.mtimeMs,
      });
    } catch (error) {
      console.error(
        "Failed to save project settings:",
        error instanceof Error ? error.message : "Unknown error"
      );
      throw error;
    }
  }

  /**
   * Update a specific project setting
   */
  public updateProjectSetting<K extends keyof ProjectSettings>(
    key: K,
    value: ProjectSettings[K]
  ): void {
    const settings = { [key]: value } as Partial<ProjectSettings>;
    this.saveProjectSettings(settings);
  }

  /**
   * Get a specific project setting
   */
  public getProjectSetting<K extends keyof ProjectSettings>(
    key: K
  ): ProjectSettings[K] {
    const settings = this.loadProjectSettings();
    return settings[key];
  }

  /**
   * Get the current model with proper fallback logic:
   * 1. Project-specific model setting
   * 2. User's default model
   * 3. System default
   */
  public getCurrentModel(): string {
    const projectModel = this.getProjectSetting("model");
    if (projectModel) {
      return projectModel;
    }

    const userDefaultModel = this.getUserSetting("defaultModel");
    if (userDefaultModel) {
      return userDefaultModel;
    }

    return DEFAULT_PROJECT_SETTINGS.model || "grok-code-fast-1";
  }

  public isRagEnabled(cwd: string = process.cwd()): boolean {
    const settings = this.loadProjectSettings(cwd);
    return !!settings.rag?.enabled;
  }

  public getRagExtractor(cwd: string = process.cwd()): "native" | "sqlite-rag" {
  const env = process.env.GROK_RAG_EXTRACTOR?.trim().toLowerCase();
  if (env === "sqlite-rag" || env === "sqlite_rag" || env === "sqlite")
    return "sqlite-rag";
  if (env === "native") return "native";

  const settings = this.loadProjectSettings(cwd);
  const v = settings.rag?.extractor;
  return v === "sqlite-rag" ? "sqlite-rag" : "native";
}

public getRagPython(cwd: string = process.cwd()): string | undefined {
  const env = process.env.GROK_RAG_PYTHON?.trim();
  if (env) return env;

  const settings = this.loadProjectSettings(cwd);
  const v = settings.rag?.python;
  return v && v.trim() ? v.trim() : undefined;
}

public getRagTopK(cwd: string = process.cwd()): number {
    const settings = this.loadProjectSettings(cwd);
    return settings.rag?.topK ?? (DEFAULT_PROJECT_SETTINGS.rag?.topK ?? 6);
  }

  public getRagUseKMedoids(cwd: string = process.cwd()): boolean {
    const settings = this.loadProjectSettings(cwd);
    return !!settings.rag?.useKMedoids;
  }

  public getRagCandidateCount(cwd: string = process.cwd()): number {
    const settings = this.loadProjectSettings(cwd);
    const topK = this.getRagTopK(cwd);
    const defaultCount = Math.min(50, Math.max(topK, 3 * topK));
    const raw = settings.rag?.candidateCount;
    const n =
      typeof raw === "number" && Number.isFinite(raw) ? Math.floor(raw) : defaultCount;
    return Math.max(topK, Math.min(200, n));
  }

  /**
   * Set the current model for the project
   */
  public setCurrentModel(model: string): void {
    this.updateProjectSetting("model", model);
  }

  /**
   * Get available models list from user settings
   */
  public getAvailableModels(): string[] {
    const models = this.getUserSetting("models");
    return models || DEFAULT_USER_SETTINGS.models || [];
  }

  public getDefaultModels(): string[] {
    return DEFAULT_USER_SETTINGS.models || [];
  }

  /**
   * Get API key from user settings or environment
   */
  public getApiKey(): string | undefined {
    // First check environment variable
    const envApiKey = process.env.GROK_API_KEY;
    if (envApiKey) {
      return envApiKey;
    }

    // Then check user settings
    return this.getUserSetting("apiKey");
  }

  /**
   * Get base URL from user settings or environment
   */
  public getBaseURL(): string {
    // First check environment variable
    const envBaseURL = process.env.GROK_BASE_URL;
    if (envBaseURL) {
      return envBaseURL;
    }

    // Then check user settings
    const userBaseURL = this.getUserSetting("baseURL");
    return (
      userBaseURL || DEFAULT_USER_SETTINGS.baseURL || "https://api.x.ai/v1"
    );
  }

  public getMaxTokens(): number {
    const envMax = Number(process.env.GROK_MAX_TOKENS);
    if (Number.isFinite(envMax) && envMax > 0) return envMax;

    const settings = this.loadUserSettings();
    const v = settings.maxTokens;
    return Number.isFinite(v) && (v as number) > 0 ? (v as number) : 1536;
  }

  public getMorphApiKey(): string | undefined {
    const envKey = process.env.MORPH_API_KEY;
    if (envKey && envKey.trim()) return envKey.trim();
    const settings = this.loadUserSettings();
    return settings.morphApiKey;
  }

  public getEmbeddingsSettings(cwd: string = process.cwd()): EmbeddingsSettings {
    const envBaseURL = process.env.GROK_EMBEDDINGS_BASE_URL?.trim();
    const envModel = process.env.GROK_EMBEDDINGS_MODEL?.trim();

    const user = this.loadUserSettings();
    const project = this.loadProjectSettings(cwd);

    const baseURL =
      envBaseURL ||
      project.rag?.embeddings?.baseURL ||
      user.embeddings?.baseURL ||
      this.getBaseURL();

    const model =
      envModel ||
      project.rag?.embeddings?.model ||
      user.embeddings?.model ||
      DEFAULT_USER_SETTINGS.embeddings?.model ||
      "text-embedding-3-small";

    return { baseURL, model };
  }
}

/**
 * Convenience function to get the singleton instance
 */
export function getSettingsManager(): SettingsManager {
  return SettingsManager.getInstance();
}

// ADID_ROLLBACK (from adm.exe)
// SDID_ROLLBACK {
//   "target_file": "D:\\zPython\\grok-cli\\src/utils/settings-manager.ts"
//   "update_script": "adm.exe"
//   "backup_path": "D:\\zPython\\grok-cli\\src/utils/settings-manager.ts.backup_20260216T230043_298077"
//   "created_at": "2026-02-16T15:00:43.309453+00:00"
//   "backup_hash": "c3afff9866ad420ca6cf6d2ebdcbb1db"
//   "new_hash": "c3afff9866ad420ca6cf6d2ebdcbb1db"
//   "goal_id": "settings_manager_rag_getters_format"
//   "semantics": "Restore indentation and missing newlines between methods."
//   "update_attrs": {"relative_path": "src/utils/settings-manager.ts", "update_type": "text", "mode": "replace", "encoding": "utf-8", "find_pattern": null, "find_text": "public getRagExtractor(cwd: string = process.cwd()): \"native\" | \"sqlite-rag\" {\n  const env = process.env.GROK_RAG_EXTRACTOR?.trim().toLowerCase();\n  if (env === \"sqlite-rag\" || env === \"sqlite_rag\" || env === \"sqlite\")\n    return \"sqlite-rag\";\n  if (env === \"native\") return \"native\";\n\n  const settings = this.loadProjectSettings(cwd);\n  const v = settings.rag?.extractor;\n  return v === \"sqlite-rag\" ? \"sqlite-rag\" : \"native\";\n}\n\npublic getRagPython(cwd: string = process.cwd()): string | undefined {\n  const env = process.env.GROK_RAG_PYTHON?.trim();\n  if (env) return env;\n\n  const settings = this.loadProjectSettings(cwd);\n  const v = settings.rag?.python;\n  return v && v.trim() ? v.trim() : undefined;\n}public getRagTopK(cwd: string = process.cwd()): number {", "replace_present": true}
//   "restore_cmd": "uv run adm --rollback \"D:\\zPython\\grok-cli\\src/utils/settings-manager.ts\""
// }
