import { useState, useMemo, useEffect } from "react";
import { useInput } from "ink";
import { GrokAgent, ChatEntry } from "../agent/grok-agent.js";
import { ConfirmationService } from "../utils/confirmation-service.js";
import { useEnhancedInput, Key } from "./use-enhanced-input.js";
import { UserContent } from "../grok/client.js";

import { filterCommandSuggestions } from "../ui/components/command-suggestions.js";
import { loadModelConfig, updateCurrentModel } from "../utils/model-config.js";
import { getClipboardImage } from "../utils/clipboard-image.js";
import {
  buildUserContent,
  readLocalImageAsDataUrl,
  type PendingImageAttachment,
} from "../utils/attachment-utils.js";
import { isThemeId, listThemes } from "../ui/utils/theme.js";
import { useTheme } from "../ui/context/theme-context.js";
import { getSettingsManager } from "../utils/settings-manager.js";
import { getConfigCategories, getConfigRegistry } from "../config/registry.js";
import { maskSecret } from "../config/effective-config.js";

/** Pasted content longer than this is treated as text; clipboard image check is skipped. */
const PASTE_TEXT_THRESHOLD = 1000;

interface UseInputHandlerProps {
  agent: GrokAgent;
  chatHistory: ChatEntry[];
  setChatHistory: React.Dispatch<React.SetStateAction<ChatEntry[]>>;
  setIsProcessing: (processing: boolean) => void;
  setIsStreaming: (streaming: boolean) => void;
  setTokenCount: (count: number) => void;
  setProcessingTime: (time: number) => void;
  processingStartTime: React.MutableRefObject<number>;
  isProcessing: boolean;
  isStreaming: boolean;
  isConfirmationActive?: boolean;
}

interface CommandSuggestion {
  command: string;
  description: string;
}

interface ModelOption {
  model: string;
}

interface ConfigMenuItem {
  id: string;
  label: string;
  value?: string;
  hint?: string;
}

export function useInputHandler({
  agent,
  chatHistory: _chatHistory,
  setChatHistory,
  setIsProcessing,
  setIsStreaming,
  setTokenCount,
  setProcessingTime,
  processingStartTime,
  isProcessing,
  isStreaming,
  isConfirmationActive = false,
}: UseInputHandlerProps) {
  const { themeId, setThemeId } = useTheme();
  const [showCommandSuggestions, setShowCommandSuggestions] = useState(false);
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0);
  const [showModelSelection, setShowModelSelection] = useState(false);
  const [selectedModelIndex, setSelectedModelIndex] = useState(0);
  const [showThemeSelection, setShowThemeSelection] = useState(false);
  const [selectedThemeIndex, setSelectedThemeIndex] = useState(0);
  const [settingsNonce, setSettingsNonce] = useState(0);
  const [showConfigMenu, setShowConfigMenu] = useState(false);
  const [configMenuTitle, setConfigMenuTitle] = useState("Configuration");
  const [configMenuItems, setConfigMenuItems] = useState<ConfigMenuItem[]>([]);
  const [selectedConfigIndex, setSelectedConfigIndex] = useState(0);
  const [configMenuStack, setConfigMenuStack] = useState<
    Array<{ title: string; items: ConfigMenuItem[]; index: number }>
  >([]);
  const [configInputPrompt, setConfigInputPrompt] = useState<string | null>(null);
  const [configInputKey, setConfigInputKey] = useState<string | null>(null);
  const [configInputMask, setConfigInputMask] = useState(false);
  const [autoEditEnabled, setAutoEditEnabled] = useState(() => {
    const confirmationService = ConfirmationService.getInstance();
    const sessionFlags = confirmationService.getSessionFlags();
    return sessionFlags.allOperations;
  });
  const [pendingImageAttachments, setPendingImageAttachments] = useState<
    PendingImageAttachment[]
  >([]);

  const buildUserContentWithAttachments = (userInput: string): UserContent =>
    buildUserContent(userInput, pendingImageAttachments);

  const settingsManager = getSettingsManager();

  const getConfigValueLabel = (key: string): string => {
    const user = settingsManager.loadUserSettings();
    const project = settingsManager.loadProjectSettings();
    switch (key) {
      case "user.apiKey":
        return user.apiKey ? maskSecret(user.apiKey) : "(not set)";
      case "user.baseURL":
        return user.baseURL || "(default)";
      case "project.model":
        return project.model || "(default)";
      case "user.defaultModel":
        return user.defaultModel || "(default)";
      case "user.maxTokens":
        return String(user.maxTokens ?? "(default)");
      case "user.models":
        return Array.isArray(user.models) ? `${user.models.length} models` : "(default list)";
      case "user.theme":
        return user.theme || "(default)";
      case "project.rag.enabled":
        return project.rag?.enabled ? "enabled" : "disabled";
      case "project.rag.topK":
        return String(project.rag?.topK ?? 6);
      case "user.embeddings.model":
        return user.embeddings?.model || "text-embedding-3-small";
      case "user.embeddings.baseURL":
        return user.embeddings?.baseURL || "(same as baseURL)";
      case "user.morphApiKey":
        return user.morphApiKey ? maskSecret(user.morphApiKey) : "(not set)";
      default:
        return "";
    }
  };

  const openConfigRootMenu = (): void => {
    const categories = getConfigCategories();
    const items: ConfigMenuItem[] = [
      ...categories.map((c) => ({ id: `cat:${c}`, label: c })),
      { id: "action:showEffective", label: "Show effective config (with sources)" },
      { id: "action:mcpHelp", label: "MCP servers (manage via grok mcp …)" },
      { id: "action:ragHelp", label: "RAG actions (grok rag index/status)" },
      { id: "action:close", label: "Close" },
    ];
    setConfigMenuTitle("Configuration");
    setConfigMenuItems(items);
    setSelectedConfigIndex(0);
    setConfigMenuStack([]);
    setShowConfigMenu(true);
  };

  const openConfigCategoryMenu = (category: string): void => {
    const defs = getConfigRegistry().filter((d) => d.category === category);
    const items: ConfigMenuItem[] = defs.map((d) => ({
      id: `key:${d.key}`,
      label: d.key,
      value: getConfigValueLabel(d.key),
      hint: d.description,
    }));
    items.push({ id: "nav:back", label: "Back" });
    setConfigMenuTitle(`Config: ${category}`);
    setConfigMenuItems(items);
    setSelectedConfigIndex(0);
    setShowConfigMenu(true);
  };

  const beginConfigInput = (key: string, prompt: string, mask: boolean): void => {
    setConfigInputKey(key);
    setConfigInputPrompt(prompt);
    setConfigInputMask(mask);
    clearInput();
  };

  const applyConfigValue = async (key: string, raw: string): Promise<void> => {
    const trimmed = raw.trim();
    const user = settingsManager.loadUserSettings();
    const project = settingsManager.loadProjectSettings();

    const push = (content: string) =>
      setChatHistory((prev) => [
        ...prev,
        { type: "assistant", content, timestamp: new Date() },
      ]);

    switch (key) {
      case "user.apiKey": {
        if (!trimmed) {
          push("✗ API key not changed (empty).");
          return;
        }
        settingsManager.updateUserSetting("apiKey", trimmed);
        agent.reconfigureConnection({ apiKey: trimmed });
        push("✓ API key saved.");
        return;
      }
      case "user.baseURL": {
        if (!trimmed) {
          push("✗ baseURL not changed (empty).");
          return;
        }
        settingsManager.updateUserSetting("baseURL", trimmed);
        agent.reconfigureConnection({ baseURL: trimmed });
        push(`✓ baseURL saved: ${trimmed}`);
        return;
      }
      case "project.model": {
        if (!trimmed) return;
        agent.setModel(trimmed);
        updateCurrentModel(trimmed);
        push(`✓ Project model set: ${trimmed}`);
        return;
      }
      case "user.defaultModel": {
        if (!trimmed) return;
        settingsManager.updateUserSetting("defaultModel", trimmed);
        setSettingsNonce((n) => n + 1);
        push(`✓ Default model set: ${trimmed}`);
        return;
      }
      case "user.maxTokens": {
        const n = Number(trimmed);
        if (!Number.isFinite(n) || n <= 0) {
          push("✗ maxTokens must be a positive number.");
          return;
        }
        settingsManager.updateUserSetting("maxTokens", n);
        agent.reconfigureConnection({ maxTokens: n });
        push(`✓ maxTokens saved: ${n}`);
        return;
      }
      case "user.models": {
        const list = trimmed
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        if (list.length === 0) {
          push("✗ models list cannot be empty.");
          return;
        }
        settingsManager.updateUserSetting("models", list);
        setSettingsNonce((n) => n + 1);
        push(`✓ Saved ${list.length} models.`);
        return;
      }
      case "user.theme": {
        if (isThemeId(trimmed)) {
          setThemeId(trimmed);
          push(`✓ Theme set: ${trimmed}`);
        } else {
          push("✗ Invalid theme id.");
        }
        return;
      }
      case "project.rag.enabled": {
        const enabled = trimmed.toLowerCase() === "true" || trimmed === "1";
        settingsManager.updateProjectSetting("rag", {
          ...(project.rag || {}),
          enabled,
        });
        push(`✓ RAG is now ${enabled ? "enabled" : "disabled"} for this project.`);
        return;
      }
      case "project.rag.topK": {
        const k = Number(trimmed);
        if (!Number.isFinite(k) || k <= 0) {
          push("✗ topK must be a positive number.");
          return;
        }
        settingsManager.updateProjectSetting("rag", {
          ...(project.rag || {}),
          topK: k,
        });
        push(`✓ RAG topK saved: ${k}`);
        return;
      }
      case "project.rag.embeddings.model": {
        if (!trimmed) return;
        settingsManager.updateProjectSetting("rag", {
          ...(project.rag || {}),
          embeddings: {
            ...((project.rag || {}).embeddings || {}),
            model: trimmed,
          },
        });
        push(`✓ Project embeddings model saved: ${trimmed}`);
        return;
      }
      case "project.rag.embeddings.baseURL": {
        if (!trimmed) return;
        settingsManager.updateProjectSetting("rag", {
          ...(project.rag || {}),
          embeddings: {
            ...((project.rag || {}).embeddings || {}),
            baseURL: trimmed,
          },
        });
        push(`✓ Project embeddings baseURL saved: ${trimmed}`);
        return;
      }
      case "user.embeddings.model": {
        if (!trimmed) return;
        settingsManager.updateUserSetting("embeddings", {
          ...(user.embeddings || {}),
          model: trimmed,
        });
        push(`✓ Embeddings model saved: ${trimmed}`);
        return;
      }
      case "user.embeddings.baseURL": {
        if (!trimmed) return;
        settingsManager.updateUserSetting("embeddings", {
          ...(user.embeddings || {}),
          baseURL: trimmed,
        });
        push(`✓ Embeddings baseURL saved: ${trimmed}`);
        return;
      }
      case "user.morphApiKey": {
        if (!trimmed) {
          push("✗ Morph API key not changed (empty).");
          return;
        }
        settingsManager.updateUserSetting("morphApiKey", trimmed);
        agent.refreshMorphEditor();
        push("✓ Morph API key saved. Morph editing is now available (if supported by your model/tools).");
        return;
      }
      default:
        push(`✗ Unknown config key: ${key}`);
    }
  };

  const handleSpecialKey = async (
    key: Key,
    pasteText?: string
  ): Promise<boolean> => {
    // Don't handle input if confirmation dialog is active
    if (isConfirmationActive) {
      return true; // Prevent default handling
    }

    // Config menu navigation
    if (showConfigMenu) {
      if (key.escape) {
        const stack = configMenuStack;
        if (stack.length > 0) {
          const prev = stack[stack.length - 1];
          setConfigMenuTitle(prev.title);
          setConfigMenuItems(prev.items);
          setSelectedConfigIndex(prev.index);
          setConfigMenuStack(stack.slice(0, -1));
          return true;
        }
        setShowConfigMenu(false);
        setSelectedConfigIndex(0);
        return true;
      }
      if (key.upArrow || key.name === "up") {
        setSelectedConfigIndex((prev) =>
          prev === 0 ? configMenuItems.length - 1 : prev - 1
        );
        return true;
      }
      if (key.downArrow || key.name === "down") {
        setSelectedConfigIndex((prev) => (prev + 1) % configMenuItems.length);
        return true;
      }
      if (key.tab || key.return || key.name === "return") {
        const item = configMenuItems[selectedConfigIndex];
        if (!item) return true;

        if (item.id === "action:close") {
          setShowConfigMenu(false);
          setSelectedConfigIndex(0);
          return true;
        }
        if (item.id === "action:showEffective") {
          const { getEffectiveConfig, maskSecret } = await import(
            "../config/effective-config.js"
          );
          const rows = getEffectiveConfig()
            .map((it: any) => {
              const isSecret = String(it.key).toLowerCase().includes("key");
              const val = isSecret ? maskSecret(it.value) : it.value;
              const note = it.note ? ` (${it.note})` : "";
              return `${it.key} = ${String(val)}  [${it.source}]${note}`;
            })
            .join("\n");
          setChatHistory((prev) => [
            ...prev,
            { type: "assistant", content: rows, timestamp: new Date() },
          ]);
          setShowConfigMenu(false);
          return true;
        }
        if (item.id === "action:mcpHelp") {
          setChatHistory((prev) => [
            ...prev,
            {
              type: "assistant",
              content:
                "MCP is managed via CLI:\n\n- grok mcp list\n- grok mcp add <name> [options]\n- grok mcp remove <name>\n- grok mcp test <name>\n\nProject settings are stored in .grok/settings.json under mcpServers.",
              timestamp: new Date(),
            },
          ]);
          setShowConfigMenu(false);
          return true;
        }
        if (item.id === "action:ragHelp") {
          setChatHistory((prev) => [
            ...prev,
            {
              type: "assistant",
              content:
                "RAG commands:\n\n- grok rag index\n- grok rag status\n\nRAG settings live in .grok/settings.json under rag.enabled and rag.topK.",
              timestamp: new Date(),
            },
          ]);
          setShowConfigMenu(false);
          return true;
        }
        if (item.id === "nav:back") {
          if (configMenuStack.length > 0) {
            const prev = configMenuStack[configMenuStack.length - 1];
            setConfigMenuTitle(prev.title);
            setConfigMenuItems(prev.items);
            setSelectedConfigIndex(prev.index);
            setConfigMenuStack(configMenuStack.slice(0, -1));
          } else {
            openConfigRootMenu();
          }
          return true;
        }
        if (item.id.startsWith("cat:")) {
          const category = item.id.slice("cat:".length);
          setConfigMenuStack((prev) => [
            ...prev,
            { title: configMenuTitle, items: configMenuItems, index: selectedConfigIndex },
          ]);
          openConfigCategoryMenu(category);
          return true;
        }
        if (item.id.startsWith("key:")) {
          const configKey = item.id.slice("key:".length);
          const def = getConfigRegistry().find((d) => d.key === configKey);
          if (!def) return true;

          const opts = def.options?.() || [];
          if (opts.length > 0) {
            // Present options as another menu level.
            setConfigMenuStack((prev) => [
              ...prev,
              { title: configMenuTitle, items: configMenuItems, index: selectedConfigIndex },
            ]);
            setConfigMenuTitle(`Set: ${def.key}`);
            setConfigMenuItems(
              opts.map((o) => ({
                id: `opt:${def.key}:${o.value}`,
                label: o.label,
              })).concat([{ id: "nav:back", label: "Back" }])
            );
            setSelectedConfigIndex(0);
            return true;
          }

          beginConfigInput(
            def.key,
            `Enter value for ${def.key} (template: ${def.template || "n/a"}):`,
            def.type === "secret"
          );
          setShowConfigMenu(false);
          return true;
        }
        if (item.id.startsWith("opt:")) {
          const parts = item.id.split(":");
          // opt:<key>:<value> (key itself may contain dots but not colons)
          const configKey = parts[1];
          const value = parts.slice(2).join(":");
          if (value === "__custom__") {
            const def = getConfigRegistry().find((d) => d.key === configKey);
            beginConfigInput(
              configKey,
              `Enter custom value for ${configKey} (template: ${def?.template || "n/a"}):`,
              def?.type === "secret"
            );
            setShowConfigMenu(false);
            return true;
          }
          if (value === "__same_as_baseURL__") {
          const keyDef = getConfigRegistry().find((d) => d.key === configKey);
          if (keyDef?.scope === "project") {
            const proj = settingsManager.loadProjectSettings();
            settingsManager.updateProjectSetting("rag", {
              ...(proj.rag || {}),
              embeddings: {
                ...((proj.rag || {}).embeddings || {}),
                baseURL: undefined,
              },
            });
            setChatHistory((prev) => [
              ...prev,
              {
                type: "assistant",
                content: "✓ Project embeddings baseURL set to: same as baseURL",
                timestamp: new Date(),
              },
            ]);
            setShowConfigMenu(false);
            return true;
          }

          settingsManager.updateUserSetting("embeddings", {
            ...(settingsManager.loadUserSettings().embeddings || {}),
            baseURL: undefined,
          });
          setChatHistory((prev) => [
            ...prev,
            {
              type: "assistant",
              content: "✓ Embeddings baseURL set to: same as baseURL",
              timestamp: new Date(),
            },
          ]);
          setShowConfigMenu(false);
          return true;
          }
          await applyConfigValue(configKey, value);
          setShowConfigMenu(false);
          return true;
        }
      }
      return true;
    }

    // Config input prompt: Escape cancels input mode.
    if (configInputKey && configInputPrompt) {
      if (key.escape) {
        setConfigInputKey(null);
        setConfigInputPrompt(null);
        setConfigInputMask(false);
        clearInput();
        setChatHistory((prev) => [
          ...prev,
          { type: "assistant", content: "Config change cancelled.", timestamp: new Date() },
        ]);
        return true;
      }
    }

    // Paste: skip clipboard image check when pasted content is clearly text (long string)
    if (key.paste) {
      if (pasteText != null && pasteText.length > PASTE_TEXT_THRESHOLD) {
        return false; // Let default handling insert pasted text immediately
      }
      try {
        const image = await getClipboardImage();
        if (image) {
          const imageUrl = `data:${image.mimeType};base64,${image.base64}`;
          setPendingImageAttachments((prev) => [
            ...prev,
            { imageUrl, label: "Pasted image" },
          ]);
          setChatHistory((prev) => [
            ...prev,
            {
              type: "assistant",
              content: "Pasted 1 image.",
              timestamp: new Date(),
            },
          ]);
          return true;
        }
        return false; // let default handling insert pasted text
      } catch {
        return false; // treat as text paste
      }
    }

    // Handle shift+tab to toggle auto-edit mode
    if (key.shift && key.tab) {
      const newAutoEditState = !autoEditEnabled;
      setAutoEditEnabled(newAutoEditState);

      const confirmationService = ConfirmationService.getInstance();
      if (newAutoEditState) {
        // Enable auto-edit: set all operations to be accepted
        confirmationService.setSessionFlag("allOperations", true);
      } else {
        // Disable auto-edit: reset session flags
        confirmationService.resetSession();
      }
      return true; // Handled
    }

    // Handle escape key for closing menus
    if (key.escape) {
      if (showCommandSuggestions) {
        setShowCommandSuggestions(false);
        setSelectedCommandIndex(0);
        return true;
      }
      if (showThemeSelection) {
        setShowThemeSelection(false);
        setSelectedThemeIndex(0);
        return true;
      }
      if (showModelSelection) {
        setShowModelSelection(false);
        setSelectedModelIndex(0);
        return true;
      }
      if (isProcessing || isStreaming) {
        agent.abortCurrentOperation();
        setIsProcessing(false);
        setIsStreaming(false);
        setTokenCount(0);
        setProcessingTime(0);
        processingStartTime.current = 0;
        return true;
      }
      return false; // Let default escape handling work
    }

    // Handle command suggestions navigation
    if (showCommandSuggestions) {
      const filteredSuggestions = filterCommandSuggestions(
        commandSuggestions,
        input
      );

      if (filteredSuggestions.length === 0) {
        setShowCommandSuggestions(false);
        setSelectedCommandIndex(0);
        return false; // Continue processing
      } else {
        if (key.upArrow) {
          setSelectedCommandIndex((prev) =>
            prev === 0 ? filteredSuggestions.length - 1 : prev - 1
          );
          return true;
        }
        if (key.downArrow) {
          setSelectedCommandIndex(
            (prev) => (prev + 1) % filteredSuggestions.length
          );
          return true;
        }
        // If the user already typed the full command, Enter should execute it (submit),
        // not autocomplete it (avoids needing two Enters to run /theme, /models, etc.).
        const safeIndex = Math.min(
          selectedCommandIndex,
          filteredSuggestions.length - 1
        );
        const selectedCommand = filteredSuggestions[safeIndex];
        const isExactCommand =
          !!selectedCommand && selectedCommand.command === input.trim();
        if (key.return && isExactCommand) {
          return false;
        }
        if (key.tab || key.return) {
          const safeIndex = Math.min(
            selectedCommandIndex,
            filteredSuggestions.length - 1
          );
          const selectedCommand = filteredSuggestions[safeIndex];
          const newInput = selectedCommand.command + " ";
          setInput(newInput);
          setCursorPosition(newInput.length);
          setShowCommandSuggestions(false);
          setSelectedCommandIndex(0);
          return true;
        }
      }
    }

    // Handle model selection navigation
    if (showModelSelection) {
      if (key.upArrow || key.name === "up") {
        setSelectedModelIndex((prev) =>
          prev === 0 ? availableModels.length - 1 : prev - 1
        );
        return true;
      }
      if (key.downArrow || key.name === "down") {
        setSelectedModelIndex((prev) => (prev + 1) % availableModels.length);
        return true;
      }
      if (key.tab || key.return || key.name === "return") {
        const selectedModel = availableModels[selectedModelIndex];
        agent.setModel(selectedModel.model);
        updateCurrentModel(selectedModel.model);
        const confirmEntry: ChatEntry = {
          type: "assistant",
          content: `✓ Switched to model: ${selectedModel.model}`,
          timestamp: new Date(),
        };
        setChatHistory((prev) => [...prev, confirmEntry]);
        setShowModelSelection(false);
        setSelectedModelIndex(0);
        return true;
      }
    }

    // Handle theme selection navigation
    if (showThemeSelection) {
      if (key.upArrow || key.name === "up") {
        setSelectedThemeIndex((prev) =>
          prev === 0 ? availableThemes.length - 1 : prev - 1
        );
        return true;
      }
      if (key.downArrow || key.name === "down") {
        setSelectedThemeIndex((prev) => (prev + 1) % availableThemes.length);
        return true;
      }
      if (key.tab || key.return || key.name === "return") {
        const selectedTheme = availableThemes[selectedThemeIndex];
        if (selectedTheme && isThemeId(selectedTheme.id)) {
          setThemeId(selectedTheme.id);
          const confirmEntry: ChatEntry = {
            type: "assistant",
            content: `✓ Switched to theme: ${selectedTheme.name} (${selectedTheme.id})`,
            timestamp: new Date(),
          };
          setChatHistory((prev) => [...prev, confirmEntry]);
        }
        setShowThemeSelection(false);
        setSelectedThemeIndex(0);
        return true;
      }
    }

    return false; // Let default handling proceed
  };

  const handleInputSubmit = async (userInput: string) => {
    if (userInput === "exit" || userInput === "quit") {
      process.exit(0);
      return;
    }

    if (configInputKey && configInputPrompt) {
      const key = configInputKey;
      setConfigInputKey(null);
      setConfigInputPrompt(null);
      setConfigInputMask(false);
      await applyConfigValue(key, userInput);
      clearInput();
      return;
    }

    if (userInput.trim()) {
      const directCommandResult = await handleDirectCommand(userInput);
      if (!directCommandResult) {
        await processUserMessage(userInput);
      }
    }
  };

  const handleInputChange = (newInput: string) => {
    // Update command suggestions based on input
    if (newInput.startsWith("/")) {
      setShowCommandSuggestions(true);
      setSelectedCommandIndex(0);
    } else {
      setShowCommandSuggestions(false);
      setSelectedCommandIndex(0);
    }
  };

  const {
    input,
    cursorPosition,
    setInput,
    setCursorPosition,
    clearInput,
    resetHistory,
    handleInput,
  } = useEnhancedInput({
    onSubmit: handleInputSubmit,
    onSpecialKey: handleSpecialKey,
    onTruncated: (trimmedCount) => {
      setChatHistory((prev) => [
        ...prev,
        {
          type: "assistant",
          content: `Input truncated to 100,000 characters (${trimmedCount.toLocaleString()} characters removed).`,
          timestamp: new Date(),
        },
      ]);
    },
    disabled: isConfirmationActive,
  });

  // Hook up the actual input handling
  useInput((inputChar: string, key: Key) => {
    handleInput(inputChar, key);
  });

  // Update command suggestions when input changes
  useEffect(() => {
    handleInputChange(input);
  }, [input]);

  const commandSuggestions: CommandSuggestion[] = [
    { command: "/help", description: "Show help information" },
    { command: "/clear", description: "Clear chat history" },
    { command: "/models", description: "Switch Grok Model" },
    { command: "/theme", description: "Switch VS Code-inspired color theme" },
    { command: "/config", description: "Configure Grok CLI (interactive)" },
    { command: "/attach", description: "Attach image for next message" },
    { command: "/attach-clear", description: "Clear attached images" },
    { command: "/commit-and-push", description: "AI commit & push to remote" },
    { command: "/exit", description: "Exit the application" },
  ];

  // Load models from configuration with fallback to defaults
  const availableModels: ModelOption[] = useMemo(() => {
    return loadModelConfig(); // Return directly, interface already matches
  }, [settingsNonce]);

  const availableThemes = useMemo(() => {
    return listThemes().map((t) => ({ id: t.id, name: t.name }));
  }, []);

  const handleDirectCommand = async (input: string): Promise<boolean> => {
    const trimmedInput = input.trim();

    if (trimmedInput === "/clear") {
      // Reset chat history
      setChatHistory([]);
      setPendingImageAttachments([]);

      // Reset processing states
      setIsProcessing(false);
      setIsStreaming(false);
      setTokenCount(0);
      setProcessingTime(0);
      processingStartTime.current = 0;

      // Reset confirmation service session flags
      const confirmationService = ConfirmationService.getInstance();
      confirmationService.resetSession();

      clearInput();
      resetHistory();
      return true;
    }

    if (trimmedInput === "/help") {
      const helpEntry: ChatEntry = {
        type: "assistant",
        content: `Grok CLI Help:

Built-in Commands:
  /clear      - Clear chat history
  /help       - Show this help
  /models     - Switch between available models
  /theme      - Switch between VS Code-inspired color themes
  /config     - Configure Grok CLI (interactive)
  /attach     - Attach an image for your next message
  /attach-clear - Clear pending image attachments
  /exit       - Exit application
  exit, quit  - Exit application

Git Commands:
  /commit-and-push - AI-generated commit + push to remote

Enhanced Input Features:
  ↑/↓ Arrow   - Navigate command history
  Ctrl+V / Cmd+V - Paste image from clipboard to attach (or paste text)
  Ctrl+C      - Clear input (press twice to exit)
  Ctrl+←/→    - Move by word
  Ctrl+A/E    - Move to line start/end
  Ctrl+W      - Delete word before cursor
  Ctrl+K      - Delete to end of line
  Ctrl+U      - Delete to start of line
  Shift+Tab   - Toggle auto-edit mode (bypass confirmations)

Direct Commands (executed immediately):
  ls [path]   - List directory contents
  pwd         - Show current directory
  cd <path>   - Change directory
  cat <file>  - View file contents
  mkdir <dir> - Create directory
  touch <file>- Create empty file

Configuration:
  Use /config (recommended) or edit ~/.grok/user-settings.json as a fallback.

For complex operations, just describe what you want in natural language.
Examples:
  "edit package.json and add a new script"
  "create a new React component called Header"
  "show me all TypeScript files in this project"`,
        timestamp: new Date(),
      };
      setChatHistory((prev) => [...prev, helpEntry]);
      clearInput();
      return true;
    }

    if (trimmedInput === "/exit") {
      process.exit(0);
      return true;
    }

    if (trimmedInput === "/models") {
      setShowModelSelection(true);
      setSelectedModelIndex(0);
      clearInput();
      return true;
    }

    if (trimmedInput === "/theme") {
      setShowThemeSelection(true);
      const idx = availableThemes.findIndex((t) => t.id === themeId);
      setSelectedThemeIndex(idx >= 0 ? idx : 0);
      clearInput();
      return true;
    }

    if (trimmedInput === "/config") {
      setShowCommandSuggestions(false);
      setSelectedCommandIndex(0);
      setShowModelSelection(false);
      setSelectedModelIndex(0);
      setShowThemeSelection(false);
      setSelectedThemeIndex(0);
      openConfigRootMenu();
      clearInput();
      return true;
    }

    if (trimmedInput.startsWith("/theme ")) {
      const themeArg = trimmedInput.slice("/theme ".length).trim();
      const themes = listThemes();
      const byId = themes.find((t) => t.id === themeArg);
      const byName =
        themes.find((t) => t.name.toLowerCase() === themeArg.toLowerCase()) ||
        themes.find((t) => t.name.toLowerCase().includes(themeArg.toLowerCase()));
      const chosen = byId || byName;

      if (chosen && isThemeId(chosen.id)) {
        setThemeId(chosen.id);
        const changedEntry: ChatEntry = {
          type: "assistant",
          content: `✓ Switched to theme: ${chosen.name} (${chosen.id})`,
          timestamp: new Date(),
        };
        setChatHistory((prev) => [...prev, changedEntry]);
      } else {
        const rows = themes
          .map((t) => `- ${t.name} (${t.id})`)
          .join("\n");
        const invalidEntry: ChatEntry = {
          type: "assistant",
          content: `Invalid theme: ${themeArg}\n\nAvailable themes:\n${rows}`,
          timestamp: new Date(),
        };
        setChatHistory((prev) => [...prev, invalidEntry]);
      }
      clearInput();
      return true;
    }

    if (trimmedInput.startsWith("/models ")) {
      const modelArg = trimmedInput.split(" ")[1];
      const modelNames = availableModels.map((m) => m.model);

      if (modelNames.includes(modelArg)) {
        agent.setModel(modelArg);
        updateCurrentModel(modelArg); // Update project current model
        const confirmEntry: ChatEntry = {
          type: "assistant",
          content: `✓ Switched to model: ${modelArg}`,
          timestamp: new Date(),
        };
        setChatHistory((prev) => [...prev, confirmEntry]);
      } else {
        const errorEntry: ChatEntry = {
          type: "assistant",
          content: `Invalid model: ${modelArg}

Available models: ${modelNames.join(", ")}`,
          timestamp: new Date(),
        };
        setChatHistory((prev) => [...prev, errorEntry]);
      }

      clearInput();
      return true;
    }

    if (trimmedInput === "/attach") {
      const attachHelpEntry: ChatEntry = {
        type: "assistant",
        content:
          "Usage: /attach <image-path>\nSupported formats: .png, .jpg, .jpeg (max 20MiB)\nUse /attach-clear to remove queued images.",
        timestamp: new Date(),
      };
      setChatHistory((prev) => [...prev, attachHelpEntry]);
      clearInput();
      return true;
    }

    if (trimmedInput === "/attach-clear") {
      setPendingImageAttachments([]);
      const clearedEntry: ChatEntry = {
        type: "assistant",
        content: "Cleared pending image attachments.",
        timestamp: new Date(),
      };
      setChatHistory((prev) => [...prev, clearedEntry]);
      clearInput();
      return true;
    }

    if (trimmedInput.startsWith("/attach ")) {
      const fileArg = trimmedInput.slice("/attach ".length).trim();
      try {
        const attachment = await readLocalImageAsDataUrl(fileArg);
        setPendingImageAttachments((prev) => [...prev, attachment]);
        const attachedEntry: ChatEntry = {
          type: "assistant",
          content: `Attached image: ${attachment.label}`,
          timestamp: new Date(),
        };
        setChatHistory((prev) => [...prev, attachedEntry]);
      } catch (error: any) {
        const attachErrorEntry: ChatEntry = {
          type: "assistant",
          content: `Attach failed: ${error.message}`,
          timestamp: new Date(),
        };
        setChatHistory((prev) => [...prev, attachErrorEntry]);
      }

      clearInput();
      return true;
    }


    if (trimmedInput === "/commit-and-push") {
      const userEntry: ChatEntry = {
        type: "user",
        content: "/commit-and-push",
        timestamp: new Date(),
      };
      setChatHistory((prev) => [...prev, userEntry]);

      setIsProcessing(true);
      setIsStreaming(true);

      try {
        // First check if there are any changes at all
        const initialStatusResult = await agent.executeBashCommand(
          "git status --porcelain"
        );

        if (
          !initialStatusResult.success ||
          !initialStatusResult.output?.trim()
        ) {
          const noChangesEntry: ChatEntry = {
            type: "assistant",
            content: "No changes to commit. Working directory is clean.",
            timestamp: new Date(),
          };
          setChatHistory((prev) => [...prev, noChangesEntry]);
          setIsProcessing(false);
          setIsStreaming(false);
          setInput("");
          return true;
        }

        // Add all changes
        const addResult = await agent.executeBashCommand("git add .");

        if (!addResult.success) {
          const addErrorEntry: ChatEntry = {
            type: "assistant",
            content: `Failed to stage changes: ${
              addResult.error || "Unknown error"
            }`,
            timestamp: new Date(),
          };
          setChatHistory((prev) => [...prev, addErrorEntry]);
          setIsProcessing(false);
          setIsStreaming(false);
          setInput("");
          return true;
        }

        // Show that changes were staged
        const addEntry: ChatEntry = {
          type: "tool_result",
          content: "Changes staged successfully",
          timestamp: new Date(),
          toolCall: {
            id: `git_add_${Date.now()}`,
            type: "function",
            function: {
              name: "bash",
              arguments: JSON.stringify({ command: "git add ." }),
            },
          },
          toolResult: addResult,
        };
        setChatHistory((prev) => [...prev, addEntry]);

        // Get staged changes for commit message generation
        const diffResult = await agent.executeBashCommand("git diff --cached");

        // Generate commit message using AI
        const commitPrompt = `Generate a concise, professional git commit message for these changes:

Git Status:
${initialStatusResult.output}

Git Diff (staged changes):
${diffResult.output || "No staged changes shown"}

Follow conventional commit format (feat:, fix:, docs:, etc.) and keep it under 72 characters.
Respond with ONLY the commit message, no additional text.`;

        let commitMessage = "";
        let streamingEntry: ChatEntry | null = null;

        for await (const chunk of agent.processUserMessageStream(
          commitPrompt
        )) {
          if (chunk.type === "content" && chunk.content) {
            if (!streamingEntry) {
              const newEntry = {
                type: "assistant" as const,
                content: `Generating commit message...\n\n${chunk.content}`,
                timestamp: new Date(),
                isStreaming: true,
              };
              setChatHistory((prev) => [...prev, newEntry]);
              streamingEntry = newEntry;
              commitMessage = chunk.content;
            } else {
              commitMessage += chunk.content;
              setChatHistory((prev) =>
                prev.map((entry, idx) =>
                  idx === prev.length - 1 && entry.isStreaming
                    ? {
                        ...entry,
                        content: `Generating commit message...\n\n${commitMessage}`,
                      }
                    : entry
                )
              );
            }
          } else if (chunk.type === "done") {
            if (streamingEntry) {
              setChatHistory((prev) =>
                prev.map((entry) =>
                  entry.isStreaming
                    ? {
                        ...entry,
                        content: `Generated commit message: "${commitMessage.trim()}"`,
                        isStreaming: false,
                      }
                    : entry
                )
              );
            }
            break;
          }
        }

        // Execute the commit
        const cleanCommitMessage = commitMessage
          .trim()
          .replace(/^["']|["']$/g, "");
        const commitCommand = `git commit -m "${cleanCommitMessage}"`;
        const commitResult = await agent.executeBashCommand(commitCommand);

        const commitEntry: ChatEntry = {
          type: "tool_result",
          content: commitResult.success
            ? commitResult.output || "Commit successful"
            : commitResult.error || "Commit failed",
          timestamp: new Date(),
          toolCall: {
            id: `git_commit_${Date.now()}`,
            type: "function",
            function: {
              name: "bash",
              arguments: JSON.stringify({ command: commitCommand }),
            },
          },
          toolResult: commitResult,
        };
        setChatHistory((prev) => [...prev, commitEntry]);

        // If commit was successful, push to remote
        if (commitResult.success) {
          // First try regular push, if it fails try with upstream setup
          let pushResult = await agent.executeBashCommand("git push");
          let pushCommand = "git push";

          if (
            !pushResult.success &&
            pushResult.error?.includes("no upstream branch")
          ) {
            pushCommand = "git push -u origin HEAD";
            pushResult = await agent.executeBashCommand(pushCommand);
          }

          const pushEntry: ChatEntry = {
            type: "tool_result",
            content: pushResult.success
              ? pushResult.output || "Push successful"
              : pushResult.error || "Push failed",
            timestamp: new Date(),
            toolCall: {
              id: `git_push_${Date.now()}`,
              type: "function",
              function: {
                name: "bash",
                arguments: JSON.stringify({ command: pushCommand }),
              },
            },
            toolResult: pushResult,
          };
          setChatHistory((prev) => [...prev, pushEntry]);
        }
      } catch (error: any) {
        const errorEntry: ChatEntry = {
          type: "assistant",
          content: `Error during commit and push: ${error.message}`,
          timestamp: new Date(),
        };
        setChatHistory((prev) => [...prev, errorEntry]);
      }

      setIsProcessing(false);
      setIsStreaming(false);
      clearInput();
      return true;
    }

    const directBashCommands = [
      "ls",
      "pwd",
      "cd",
      "cat",
      "mkdir",
      "touch",
      "echo",
      "grep",
      "find",
      "cp",
      "mv",
      "rm",
    ];
    const firstWord = trimmedInput.split(" ")[0];

    if (directBashCommands.includes(firstWord)) {
      const userEntry: ChatEntry = {
        type: "user",
        content: trimmedInput,
        timestamp: new Date(),
      };
      setChatHistory((prev) => [...prev, userEntry]);

      try {
        const result = await agent.executeBashCommand(trimmedInput);

        const commandEntry: ChatEntry = {
          type: "tool_result",
          content: result.success
            ? result.output || "Command completed"
            : result.error || "Command failed",
          timestamp: new Date(),
          toolCall: {
            id: `bash_${Date.now()}`,
            type: "function",
            function: {
              name: "bash",
              arguments: JSON.stringify({ command: trimmedInput }),
            },
          },
          toolResult: result,
        };
        setChatHistory((prev) => [...prev, commandEntry]);
      } catch (error: any) {
        const errorEntry: ChatEntry = {
          type: "assistant",
          content: `Error executing command: ${error.message}`,
          timestamp: new Date(),
        };
        setChatHistory((prev) => [...prev, errorEntry]);
      }

      clearInput();
      return true;
    }

    return false;
  };

  const processUserMessage = async (userInput: string) => {
    const userContent = buildUserContentWithAttachments(userInput);
    const userEntry: ChatEntry = {
      type: "user",
      content: userContent,
      timestamp: new Date(),
    };
    setChatHistory((prev) => [...prev, userEntry]);

    setIsProcessing(true);
    clearInput();
    setPendingImageAttachments([]);

    try {
      setIsStreaming(true);
      let streamingEntry: ChatEntry | null = null;

      for await (const chunk of agent.processUserMessageStream(userContent)) {
        switch (chunk.type) {
          case "content":
            if (chunk.content) {
              if (!streamingEntry) {
                const newStreamingEntry = {
                  type: "assistant" as const,
                  content: chunk.content,
                  timestamp: new Date(),
                  isStreaming: true,
                };
                setChatHistory((prev) => [...prev, newStreamingEntry]);
                streamingEntry = newStreamingEntry;
              } else {
                setChatHistory((prev) =>
                  prev.map((entry, idx) =>
                    idx === prev.length - 1 && entry.isStreaming
                      ? {
                          ...entry,
                          content:
                            (typeof entry.content === "string"
                              ? entry.content
                              : "") + chunk.content,
                        }
                      : entry
                  )
                );
              }
            }
            break;

          case "token_count":
            if (chunk.tokenCount !== undefined) {
              setTokenCount(chunk.tokenCount);
            }
            break;

          case "tool_calls":
            if (chunk.toolCalls) {
              // Stop streaming for the current assistant message
              setChatHistory((prev) =>
                prev.map((entry) =>
                  entry.isStreaming
                    ? {
                        ...entry,
                        isStreaming: false,
                        toolCalls: chunk.toolCalls,
                      }
                    : entry
                )
              );
              streamingEntry = null;

              // Add individual tool call entries to show tools are being executed
              chunk.toolCalls.forEach((toolCall) => {
                const toolCallEntry: ChatEntry = {
                  type: "tool_call",
                  content: "Executing...",
                  timestamp: new Date(),
                  toolCall: toolCall,
                };
                setChatHistory((prev) => [...prev, toolCallEntry]);
              });
            }
            break;

          case "tool_result": {
            const toolResult = chunk.toolResult;
            if (chunk.toolCall && toolResult) {
              setChatHistory((prev) =>
                prev.map((entry) => {
                  if (entry.isStreaming) {
                    return { ...entry, isStreaming: false };
                  }
                  // Update the existing tool_call entry with the result
                  if (
                    entry.type === "tool_call" &&
                    entry.toolCall?.id === chunk.toolCall?.id
                  ) {
                    return {
                      ...entry,
                      type: "tool_result",
                      content: toolResult.success
                        ? toolResult.output || "Success"
                        : toolResult.error || "Error occurred",
                      toolResult,
                    };
                  }
                  return entry;
                })
              );
              streamingEntry = null;
            }
          }
            break;

          case "done":
            if (streamingEntry) {
              setChatHistory((prev) =>
                prev.map((entry) =>
                  entry.isStreaming ? { ...entry, isStreaming: false } : entry
                )
              );
            }
            setIsStreaming(false);
            break;
        }
      }
    } catch (error: any) {
      const errorEntry: ChatEntry = {
        type: "assistant",
        content: `Error: ${error.message}`,
        timestamp: new Date(),
      };
      setChatHistory((prev) => [...prev, errorEntry]);
      setIsStreaming(false);
    }

    setIsProcessing(false);
    processingStartTime.current = 0;
  };


  return {
    input,
    cursorPosition,
    showCommandSuggestions,
    selectedCommandIndex,
    showModelSelection,
    selectedModelIndex,
    showThemeSelection,
    selectedThemeIndex,
    showConfigMenu,
    configMenuTitle,
    configMenuItems,
    selectedConfigIndex,
    configInputPrompt,
    configInputMask,
    commandSuggestions,
    availableModels,
    availableThemes,
    agent,
    autoEditEnabled,
    pendingImageCount: pendingImageAttachments.length,
  };
}
