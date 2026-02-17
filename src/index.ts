#!/usr/bin/env node
import React from "react";
import { render } from "ink";
import { program } from "commander";
import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";
import { spawnSync } from "child_process";
import { GrokAgent } from "./agent/grok-agent.js";
import ChatInterface from "./ui/components/chat-interface.js";
import { ThemeProvider } from "./ui/context/theme-context.js";
import { getSettingsManager } from "./utils/settings-manager.js";
import { loadModelConfig } from "./utils/model-config.js";
import { ConfirmationService } from "./utils/confirmation-service.js";
import { createMCPCommand } from "./commands/mcp.js";
import { UserContentPart } from "./grok/client.js";
import { isThemeId, listThemes } from "./ui/utils/theme.js";
import { indexProject } from "./rag/indexer.js";
import { VectorDb } from "./rag/vector-db.js";
import {
  exportVectorDbToMakerAiJson,
  importMakerAiJsonToVectorDb,
} from "./rag/makerai.js";
import { getEffectiveConfig, maskSecret } from "./config/effective-config.js";
import { findConfigKey } from "./config/registry.js";

// Load environment variables
dotenv.config();

// Disable default SIGINT handling to let Ink handle Ctrl+C
// We'll handle exit through the input system instead

process.on("SIGTERM", () => {
  // Restore terminal to normal mode before exit
  if (process.stdin.isTTY && process.stdin.setRawMode) {
    try {
      process.stdin.setRawMode(false);
    } catch {
      // Ignore errors when setting raw mode
    }
  }
  console.log("\nGracefully shutting down...");
  process.exit(0);
});

// Handle uncaught exceptions to prevent hanging
process.on("uncaughtException", (error) => {
  console.error("Uncaught exception:", error);
  process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled rejection at:", promise, "reason:", reason);
  process.exit(1);
});

// Ensure user settings are initialized
function ensureUserSettingsDirectory(): void {
  try {
    const manager = getSettingsManager();
    // This will create default settings if they don't exist
    manager.loadUserSettings();
  } catch {
    // Silently ignore errors during setup
  }
}

// Load API key from user settings if not in environment
function loadApiKey(): string | undefined {
  const manager = getSettingsManager();
  return manager.getApiKey();
}

// Load base URL from user settings if not in environment
function loadBaseURL(): string {
  const manager = getSettingsManager();
  return manager.getBaseURL();
}

// Save command line settings to user settings file
async function saveCommandLineSettings(
  apiKey?: string,
  baseURL?: string
): Promise<void> {
  try {
    const manager = getSettingsManager();

    // Update with command line values
    if (apiKey) {
      manager.updateUserSetting("apiKey", apiKey);
      console.log("✅ API key saved to ~/.grok/user-settings.json");
    }
    if (baseURL) {
      manager.updateUserSetting("baseURL", baseURL);
      console.log("✅ Base URL saved to ~/.grok/user-settings.json");
    }
  } catch (error) {
    console.warn(
      "⚠️ Could not save settings to file:",
      error instanceof Error ? error.message : "Unknown error"
    );
  }
}

// Load model from user settings if not in environment
function loadModel(): string | undefined {
  // First check environment variables
  let model = process.env.GROK_MODEL;

  if (!model) {
    // Use the unified model loading from settings manager
    try {
      const manager = getSettingsManager();
      model = manager.getCurrentModel();
  } catch {
    // Ignore errors, model will remain undefined
    }
  }

  return model;
}

function listModelsAndExit(selectedModel?: string): never {
  const availableModels = loadModelConfig();

  if (availableModels.length === 0) {
    console.log("No models configured.");
    process.exit(0);
  }

  const rows = availableModels.map((item) => ({
    current: selectedModel && selectedModel === item.model ? "*" : "",
    model: item.model,
    context: item.contextWindow,
    reasoning: item.reasoning ? "yes" : "no",
    api: item.recommendedApi,
    webSearch: item.webSearchSupport ? "yes" : "no",
  }));

  const widths = {
    current: 1,
    model: Math.max(
      "Model".length,
      ...rows.map((row) => row.model.length)
    ),
    context: Math.max(
      "Context".length,
      ...rows.map((row) => row.context.length)
    ),
    reasoning: Math.max(
      "Reasoning".length,
      ...rows.map((row) => row.reasoning.length)
    ),
    api: Math.max("API".length, ...rows.map((row) => row.api.length)),
    webSearch: Math.max(
      "WebSearch".length,
      ...rows.map((row) => row.webSearch.length)
    ),
  };

  const pad = (value: string, width: number) => value.padEnd(width, " ");
  const header = [
    pad("", widths.current),
    pad("Model", widths.model),
    pad("Context", widths.context),
    pad("Reasoning", widths.reasoning),
    pad("API", widths.api),
    pad("WebSearch", widths.webSearch),
  ].join("  ");
  const divider = [
    "-".repeat(widths.current),
    "-".repeat(widths.model),
    "-".repeat(widths.context),
    "-".repeat(widths.reasoning),
    "-".repeat(widths.api),
    "-".repeat(widths.webSearch),
  ].join("  ");

  console.log("Available models:");
  console.log(header);
  console.log(divider);
  for (const row of rows) {
    console.log(
      [
        pad(row.current, widths.current),
        pad(row.model, widths.model),
        pad(row.context, widths.context),
        pad(row.reasoning, widths.reasoning),
        pad(row.api, widths.api),
        pad(row.webSearch, widths.webSearch),
      ].join("  ")
    );
  }

  if (selectedModel) {
    console.log('\n* currently selected model');
  }

  process.exit(0);
}

// Handle commit-and-push command in headless mode
async function handleCommitAndPushHeadless(
  apiKey: string,
  baseURL?: string,
  model?: string,
  maxToolRounds?: number
): Promise<void> {
  try {
    const agent = new GrokAgent(apiKey, baseURL, model, maxToolRounds);

    // Configure confirmation service for headless mode (auto-approve all operations)
    const confirmationService = ConfirmationService.getInstance();
    confirmationService.setSessionFlag("allOperations", true);

    console.log("🤖 Processing commit and push...\n");
    console.log("> /commit-and-push\n");

    // First check if there are any changes at all
    const initialStatusResult = await agent.executeBashCommand(
      "git status --porcelain"
    );

    if (!initialStatusResult.success || !initialStatusResult.output?.trim()) {
      console.log("❌ No changes to commit. Working directory is clean.");
      process.exit(1);
    }

    console.log("✅ git status: Changes detected");

    // Add all changes
    const addResult = await agent.executeBashCommand("git add .");

    if (!addResult.success) {
      console.log(
        `❌ git add: ${addResult.error || "Failed to stage changes"}`
      );
      process.exit(1);
    }

    console.log("✅ git add: Changes staged");

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

    console.log("🤖 Generating commit message...");

    const commitMessageEntries = await agent.processUserMessage(commitPrompt);
    let commitMessage = "";

    // Extract the commit message from the AI response
    for (const entry of commitMessageEntries) {
      if (
        entry.type === "assistant" &&
        typeof entry.content === "string" &&
        entry.content.trim()
      ) {
        commitMessage = entry.content.trim();
        break;
      }
    }

    if (!commitMessage) {
      console.log("❌ Failed to generate commit message");
      process.exit(1);
    }

    // Clean the commit message
    const cleanCommitMessage = commitMessage.replace(/^["']|["']$/g, "");
    console.log(`✅ Generated commit message: "${cleanCommitMessage}"`);

    // Execute the commit
    const commitCommand = `git commit -m "${cleanCommitMessage}"`;
    const commitResult = await agent.executeBashCommand(commitCommand);

    if (commitResult.success) {
      console.log(
        `✅ git commit: ${
          commitResult.output?.split("\n")[0] || "Commit successful"
        }`
      );

      // If commit was successful, push to remote
      // First try regular push, if it fails try with upstream setup
      let pushResult = await agent.executeBashCommand("git push");

      if (
        !pushResult.success &&
        pushResult.error?.includes("no upstream branch")
      ) {
        console.log("🔄 Setting upstream and pushing...");
        pushResult = await agent.executeBashCommand("git push -u origin HEAD");
      }

      if (pushResult.success) {
        console.log(
          `✅ git push: ${
            pushResult.output?.split("\n")[0] || "Push successful"
          }`
        );
      } else {
        console.log(`❌ git push: ${pushResult.error || "Push failed"}`);
        process.exit(1);
      }
    } else {
      console.log(`❌ git commit: ${commitResult.error || "Commit failed"}`);
      process.exit(1);
    }
  } catch (error: any) {
    console.error("❌ Error during commit and push:", error.message);
    process.exit(1);
  }
}

// Headless mode processing function
async function processPromptHeadless(
  prompt: string,
  apiKey: string,
  baseURL?: string,
  model?: string,
  maxToolRounds?: number
): Promise<void> {
  try {
    const agent = new GrokAgent(apiKey, baseURL, model, maxToolRounds);

    // Configure confirmation service for headless mode (auto-approve all operations)
    const confirmationService = ConfirmationService.getInstance();
    confirmationService.setSessionFlag("allOperations", true);

    // Process the user message
    const chatEntries = await agent.processUserMessage(prompt);

    const toOpenAIUserContent = (
      content: string | UserContentPart[]
    ): string | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }> => {
      if (typeof content === "string") {
        return content;
      }

      return content.map((part) =>
        part.type === "input_text"
          ? { type: "text", text: part.text }
          : { type: "image_url", image_url: { url: part.image_url } }
      );
    };

    const toTextContent = (content: string | UserContentPart[]): string => {
      if (typeof content === "string") {
        return content;
      }
      return content
        .map((part) => (part.type === "input_text" ? part.text : "[Image]"))
        .join(" ")
        .trim();
    };

    // Convert chat entries to OpenAI-compatible message objects
    const messages: any[] = [];

    for (const entry of chatEntries) {
      switch (entry.type) {
        case "user":
          messages.push({
            role: "user",
            content: toOpenAIUserContent(entry.content),
          });
          break;

        case "assistant":
          const assistantMessage: any = {
            role: "assistant",
            content: toTextContent(entry.content),
          };

          // Add tool calls if present
          if (entry.toolCalls && entry.toolCalls.length > 0) {
            assistantMessage.tool_calls = entry.toolCalls.map((toolCall) => ({
              id: toolCall.id,
              type: "function",
              function: {
                name: toolCall.function.name,
                arguments: toolCall.function.arguments,
              },
            }));
          }

          messages.push(assistantMessage);
          break;

        case "tool_result":
          if (entry.toolCall) {
            messages.push({
              role: "tool",
              tool_call_id: entry.toolCall.id,
              content: toTextContent(entry.content),
            });
          }
          break;
      }
    }

    // Output each message as a separate JSON object
    for (const message of messages) {
      console.log(JSON.stringify(message));
    }
  } catch (error: any) {
    // Output error in OpenAI compatible format
    console.log(
      JSON.stringify({
        role: "assistant",
        content: `Error: ${error.message}`,
      })
    );
    process.exit(1);
  }
}

program
  .name("grok")
  .description(
    "A conversational AI CLI tool powered by Grok with text editor capabilities"
  )
  .version("1.0.1")
  .argument("[message...]", "Initial message to send to Grok")
  .option("-d, --directory <dir>", "set working directory", process.cwd())
  .option("-k, --api-key <key>", "Grok API key (or set GROK_API_KEY env var)")
  .option(
    "-u, --base-url <url>",
    "Grok API base URL (or set GROK_BASE_URL env var)"
  )
  .option(
    "-m, --model <model>",
    "AI model to use (e.g., grok-code-fast-1, grok-4-latest) (or set GROK_MODEL env var)"
  )
  .option("--theme <theme>", "UI theme id (e.g., vscode-dark-plus)")
  .option(
    "-p, --prompt <prompt>",
    "process a single prompt and exit (headless mode)"
  )
  .option(
    "--max-tool-rounds <rounds>",
    "maximum number of tool execution rounds (default: 400)",
    "400"
  )
  .option("--list-models", "list configured models and exit")
  .action(async (message, options) => {
    if (options.directory) {
      try {
        process.chdir(options.directory);
      } catch (error: any) {
        console.error(
          `Error changing directory to ${options.directory}:`,
          error.message
        );
        process.exit(1);
      }
    }

    try {
      // Get API key from options, environment, or user settings
      const apiKey = options.apiKey || loadApiKey();
      const baseURL = options.baseUrl || loadBaseURL();
      const model = options.model || loadModel();
      const maxToolRounds = parseInt(options.maxToolRounds) || 400;

      if (options.theme) {
        const selectedTheme = String(options.theme).trim();
        if (!isThemeId(selectedTheme)) {
          const availableThemes = listThemes().map((theme) => theme.id).join(", ");
          console.error(
            `❌ Invalid theme: ${selectedTheme}\nAvailable themes: ${availableThemes}`
          );
          process.exit(1);
        }
        process.env.GROK_THEME = selectedTheme;
        getSettingsManager().updateUserSetting("theme", selectedTheme);
      }

      if (options.listModels) {
        listModelsAndExit(model);
      }

      if (!apiKey) {
        console.error(
          "❌ Error: API key required. Set GROK_API_KEY environment variable, use --api-key flag, or set \"apiKey\" field in ~/.grok/user-settings.json"
        );
        process.exit(1);
      }

      // Save API key and base URL to user settings if provided via command line
      if (options.apiKey || options.baseUrl) {
        await saveCommandLineSettings(options.apiKey, options.baseUrl);
      }

      // Headless mode: process prompt and exit
      if (options.prompt) {
        await processPromptHeadless(
          options.prompt,
          apiKey,
          baseURL,
          model,
          maxToolRounds
        );
        return;
      }

      // Interactive mode: launch UI
      const agent = new GrokAgent(apiKey, baseURL, model, maxToolRounds);
      console.log("🤖 Starting Grok CLI Conversational Assistant...\n");

      ensureUserSettingsDirectory();

      // Support variadic positional arguments for multi-word initial message
      const initialMessage = Array.isArray(message)
        ? message.join(" ")
        : message;

      render(
        React.createElement(
          ThemeProvider,
          null,
          React.createElement(ChatInterface, { agent, initialMessage })
        )
      );
    } catch (error: any) {
      console.error("❌ Error initializing Grok CLI:", error.message);
      process.exit(1);
    }
  });

// Git subcommand
const gitCommand = program
  .command("git")
  .description("Git operations with AI assistance");

gitCommand
  .command("commit-and-push")
  .description("Generate AI commit message and push to remote")
  .option("-d, --directory <dir>", "set working directory", process.cwd())
  .option("-k, --api-key <key>", "Grok API key (or set GROK_API_KEY env var)")
  .option(
    "-u, --base-url <url>",
    "Grok API base URL (or set GROK_BASE_URL env var)"
  )
  .option(
    "-m, --model <model>",
    "AI model to use (e.g., grok-code-fast-1, grok-4-latest) (or set GROK_MODEL env var)"
  )
  .option(
    "--max-tool-rounds <rounds>",
    "maximum number of tool execution rounds (default: 400)",
    "400"
  )
  .action(async (options) => {
    if (options.directory) {
      try {
        process.chdir(options.directory);
      } catch (error: any) {
        console.error(
          `Error changing directory to ${options.directory}:`,
          error.message
        );
        process.exit(1);
      }
    }

    try {
      // Get API key from options, environment, or user settings
      const apiKey = options.apiKey || loadApiKey();
      const baseURL = options.baseUrl || loadBaseURL();
      const model = options.model || loadModel();
      const maxToolRounds = parseInt(options.maxToolRounds) || 400;

      if (!apiKey) {
        console.error(
          "❌ Error: API key required. Set GROK_API_KEY environment variable, use --api-key flag, or save to ~/.grok/user-settings.json"
        );
        process.exit(1);
      }

      // Save API key and base URL to user settings if provided via command line
      if (options.apiKey || options.baseUrl) {
        await saveCommandLineSettings(options.apiKey, options.baseUrl);
      }

      await handleCommitAndPushHeadless(apiKey, baseURL, model, maxToolRounds);
    } catch (error: any) {
      console.error("❌ Error during git commit-and-push:", error.message);
      process.exit(1);
    }
  });

// MCP command
program.addCommand(createMCPCommand());

// RAG command
const ragCommand = program
  .command("rag")
  .description("Local RAG (retrieval) indexing and status");

ragCommand
  .command("index")
  .description("Index current project into .grok/rag.db")
  .option("-d, --directory <dir>", "set working directory", process.cwd())
  .option("--force", "recreate the index from scratch", false)
  .option("--chunk-lines <n>", "lines per chunk (default: 200)", "200")
  .option("--overlap-lines <n>", "overlap lines between chunks (default: 20)", "20")
  .option(
    "--max-file-bytes <n>",
    "skip files larger than this (default: 524288)",
    String(512 * 1024)
  )
  .option("--batch-size <n>", "embedding batch size (default: 32)", "32")
.option("--quantize", "quantize vectors after indexing", false)
.option("--preload", "preload quantized vectors (faster search, more memory)", false)
.option(
  "--extractor <mode>",
  "text extractor: native|sqlite-rag (default: project setting or native)"
)
.option(
  "--python <cmd>",
  "python command for sqlite-rag extractor (default: auto-detect; examples: python, python3, py)"
)
.action(async (options) => {
    if (options.directory) {
      try {
        process.chdir(options.directory);
      } catch (error: any) {
        console.error(
          `Error changing directory to ${options.directory}:`,
          error.message
        );
        process.exit(1);
      }
    }

    const extractor = options.extractor ? String(options.extractor) : undefined;
if (extractor && extractor !== "native" && extractor !== "sqlite-rag") {
  console.error("extractor must be one of: native, sqlite-rag");
  process.exit(1);
}
const extractorMode =
  extractor === "sqlite-rag"
    ? "sqlite-rag"
    : extractor === "native"
      ? "native"
      : undefined;

try {
  const res = await indexProject({
    cwd: process.cwd(),
    force: !!options.force,
    chunkLines: parseInt(options.chunkLines, 10) || 200,
    overlapLines: parseInt(options.overlapLines, 10) || 20,
    maxFileSizeBytes: parseInt(options.maxFileBytes, 10) || 512 * 1024,
    batchSize: parseInt(options.batchSize, 10) || 32,
    quantize: !!options.quantize,
    quantizePreload: !!options.preload,
    extractor: extractorMode,
    python: options.python ? String(options.python) : undefined,
  });
      console.log(`✅ RAG index written to ${res.dbPath}`);
      console.log(`✅ Files indexed: ${res.filesIndexed}`);
      console.log(`✅ Chunks indexed: ${res.chunksIndexed}`);
    } catch (error: any) {
      console.error("❌ RAG indexing failed:", error.message);
      process.exit(1);
    }
  });

ragCommand
  .command("status")
  .description("Show RAG status for the current project")
  .option("-d, --directory <dir>", "set working directory", process.cwd())
  .action(async (options) => {
    if (options.directory) {
      try {
        process.chdir(options.directory);
      } catch (error: any) {
        console.error(
          `Error changing directory to ${options.directory}:`,
          error.message
        );
        process.exit(1);
      }
    }

    const manager = getSettingsManager();
const enabled = manager.isRagEnabled();
const topK = manager.getRagTopK();
const extractor = manager.getRagExtractor();
const python = manager.getRagPython();
const dbPath = manager.getRagDbPath();

    let chunks = 0;
    if (fs.existsSync(dbPath)) {
      try {
        const db = await VectorDb.open(dbPath);
        chunks = db.getChunkCount();
        db.close();
      } catch {
        chunks = 0;
      }
    }

    console.log(`RAG enabled: ${enabled ? "yes" : "no"}`);
console.log(`RAG topK: ${topK}`);
console.log(`RAG extractor: ${extractor}`);
if (extractor === "sqlite-rag") {
  console.log(`RAG python: ${python || "(auto-detect)"}`);
}
console.log(`RAG db: ${dbPath}`);
console.log(`Indexed chunks: ${chunks}`);
  });

ragCommand
  .command("export-makerai")
  .description("Export .grok/rag.db into MakerAI RAGVector JSON format")
  .option("-d, --directory <dir>", "set working directory", process.cwd())
  .option("--db <path>", "path to rag.db (default: project .grok/rag.db)")
  .option("-o, --out <file>", "output JSON file", "makerai-ragvector.json")
  .option("--name <name>", "MakerAI vector name (default: cwd basename)")
  .option("--description <text>", "MakerAI vector description")
  .action(async (options) => {
    if (options.directory) {
      try {
        process.chdir(options.directory);
      } catch (error: any) {
        console.error(
          `Error changing directory to ${options.directory}:`,
          error.message
        );
        process.exit(1);
      }
    }

    try {
      const manager = getSettingsManager();
      const dbPath = options.db || manager.getRagDbPath();
      const res = await exportVectorDbToMakerAiJson({
        dbPath,
        outFile: options.out,
        name: options.name,
        description: options.description,
        model: "",
      });
      console.log(`? Exported ${res.chunks} chunk(s) to ${res.outFile}`);
      console.log(`? Dimension: ${res.dim}`);
    } catch (error: any) {
      console.error("? Export failed:", error.message);
      process.exit(1);
    }
  });

ragCommand
  .command("import-makerai <file>")
  .description("Import MakerAI RAGVector JSON file into .grok/rag.db")
  .option("-d, --directory <dir>", "set working directory", process.cwd())
  .option("--db <path>", "path to rag.db (default: project .grok/rag.db)")
  .option("--replace", "clear all chunks before importing", false)
  .action(async (file: string, options) => {
    if (options.directory) {
      try {
        process.chdir(options.directory);
      } catch (error: any) {
        console.error(
          `Error changing directory to ${options.directory}:`,
          error.message
        );
        process.exit(1);
      }
    }

    try {
      const manager = getSettingsManager();
      const dbPath = options.db || manager.getRagDbPath();
      const res = await importMakerAiJsonToVectorDb({
        inFile: file,
        dbPath,
        replace: !!options.replace,
      });
      console.log(`? Imported ${res.inserted} chunk(s) into ${res.dbPath}`);
      console.log(`? Dimension: ${res.dim}`);
    } catch (error: any) {
      console.error("? Import failed:", error.message);
      process.exit(1);
    }
  });

ragCommand
  .command("gui")
  .description("Open MakerAI-based GUI to browse/edit RAG (exports to JSON, supports apply/refresh)")
  .option("-d, --directory <dir>", "set working directory", process.cwd())
  .option("--db <path>", "path to rag.db (default: project .grok/rag.db)")
  .option("--json <path>", "path to MakerAI JSON (default: project .grok/makerai-ragvector.json)")
  .option("--exe <path>", "path to RagManager.exe (default: MakerAI/_build/win64/bin/RagManager.exe)")
  .option("--smoke", "run RagManager in headless smoke-test mode", false)
  .action(async (options) => {
    if (options.directory) {
      try {
        process.chdir(options.directory);
      } catch (error: any) {
        console.error(
          `Error changing directory to ${options.directory}:`,
          error.message
        );
        process.exit(1);
      }
    }

    const manager = getSettingsManager();
    const dbPath = options.db || manager.getRagDbPath();
    const jsonPath =
      options.json ||
      path.resolve(process.cwd(), ".grok", "makerai-ragvector.json");
    const smokeLogPath = path.resolve(
      process.cwd(),
      ".grok",
      "makerai-ragvector.smoke.json"
    );
    const exePath =
      options.exe ||
      path.resolve(process.cwd(), "MakerAI", "_build", "win64", "bin", "RagManager.exe");

    if (!fs.existsSync(exePath)) {
      console.error(`❌ RagManager.exe not found at: ${exePath}`);
      console.error(
        "Build it with: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-makerai.ps1"
      );
      process.exit(1);
    }

    try {
      const res = await exportVectorDbToMakerAiJson({
        dbPath,
        outFile: jsonPath,
        name: path.basename(process.cwd()),
        description: "",
        model: "",
      });
      console.log(`✓ Exported ${res.chunks} chunk(s) to ${res.outFile}`);

      const quote = (s: string) => {
        const str = String(s);
        return /[\s"]/g.test(str) ? `"${str.replaceAll('"', '\\"')}"` : str;
      };

      const selfCmd = `${quote(process.argv[0])} ${quote(process.argv[1])}`;
      const applyCmd = `${selfCmd} rag import-makerai ${quote(jsonPath)} --db ${quote(dbPath)} --replace`;
      const refreshCmd = `${selfCmd} rag export-makerai --db ${quote(dbPath)} -o ${quote(jsonPath)} --name ${quote(path.basename(process.cwd()))}`;

      const args = ["--json", jsonPath, "--db", dbPath];
      if (options.smoke) {
        args.push("--smoke", "--smoke-log", smokeLogPath, "--refresh-cmd", refreshCmd);
      } else {
        args.push("--apply-cmd", applyCmd, "--refresh-cmd", refreshCmd);
      }

      const r = spawnSync(exePath, args, {
        stdio: "inherit",
      });
      if (options.smoke) {
        if (r.status !== 0) process.exit(r.status ?? 1);
        if (fs.existsSync(smokeLogPath)) {
          console.log(`✓ RagManager smoke log: ${smokeLogPath}`);
        }
      }
    } catch (error: any) {
      console.error("❌ RAG GUI failed:", error.message);
      process.exit(1);
    }
  });

// Config command
const configCommand = program
  .command("config")
  .description("Configure Grok CLI (list/get/set/init)");

configCommand
  .command("list")
  .description("List effective configuration (and its source)")
  .option("--json", "output JSON", false)
  .option("--show-secrets", "do not mask secrets", false)
  .action((options) => {
    const items = getEffectiveConfig();
    const showSecrets = !!options.showSecrets;
    if (options.json) {
      const out = items.map((it) => ({
        ...it,
        value:
          !showSecrets && String(it.key).toLowerCase().includes("key")
            ? maskSecret(it.value)
            : it.value,
      }));
      console.log(JSON.stringify(out, null, 2));
      return;
    }

    for (const it of items) {
      const value =
        !showSecrets && String(it.key).toLowerCase().includes("key")
          ? maskSecret(it.value)
          : it.value;
      const note = it.note ? ` (${it.note})` : "";
      console.log(`${it.key} = ${String(value)}  [${it.source}]${note}`);
    }
  });

configCommand
  .command("get <key>")
  .description("Get a config value")
  .option("--json", "output JSON", false)
  .action((key: string, options) => {
    const items = getEffectiveConfig();
    const found = items.find((i) => i.key === key);
    if (!found) {
      console.error(`Unknown key: ${key}`);
      process.exit(1);
    }
    if (options.json) {
      console.log(JSON.stringify(found, null, 2));
      return;
    }
    console.log(String(found.value ?? ""));
  });

configCommand
  .command("set <key> <value>")
  .description("Set a config value (writes to settings files)")
  .action((key: string, value: string) => {
    const def = findConfigKey(key);
    if (!def) {
      console.error(`Unknown key: ${key}`);
      process.exit(1);
    }
    const manager = getSettingsManager();
    const project = manager.loadProjectSettings();
    const user = manager.loadUserSettings();

    const trimmed = String(value ?? "").trim();
    if (!trimmed) {
      console.error("Value cannot be empty.");
      process.exit(1);
    }

    switch (key) {
      case "user.apiKey":
        manager.updateUserSetting("apiKey", trimmed);
        break;
      case "user.baseURL":
        manager.updateUserSetting("baseURL", trimmed);
        break;
      case "project.model":
        manager.updateProjectSetting("model", trimmed);
        break;
      case "user.defaultModel":
        manager.updateUserSetting("defaultModel", trimmed);
        break;
      case "user.maxTokens": {
        const n = Number(trimmed);
        if (!Number.isFinite(n) || n <= 0) {
          console.error("maxTokens must be a positive number.");
          process.exit(1);
        }
        manager.updateUserSetting("maxTokens", n);
        break;
      }
      case "user.models": {
        const list = trimmed
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        if (list.length === 0) {
          console.error("models list cannot be empty.");
          process.exit(1);
        }
        manager.updateUserSetting("models", list);
        break;
      }
      case "user.theme":
        if (!isThemeId(trimmed)) {
          console.error(`Invalid theme id: ${trimmed}`);
          process.exit(1);
        }
        manager.updateUserSetting("theme", trimmed);
        break;
      case "project.rag.enabled": {
        const enabled = trimmed.toLowerCase() === "true" || trimmed === "1";
        manager.updateProjectSetting("rag", { ...(project.rag || {}), enabled });
        break;
      }
      case "project.rag.topK": {
        const k = Number(trimmed);
        if (!Number.isFinite(k) || k <= 0) {
          console.error("topK must be a positive number.");
          process.exit(1);
        }
        manager.updateProjectSetting("rag", { ...(project.rag || {}), topK: k });
        break;
      }
      case "project.rag.useKMedoids": {
        const enabled = trimmed.toLowerCase() === "true" || trimmed === "1";
        manager.updateProjectSetting("rag", {
          ...(project.rag || {}),
          useKMedoids: enabled,
        });
        break;
      }
      case "project.rag.candidateCount": {
        const n = Number(trimmed);
        const topK = manager.getRagTopK();
        if (!Number.isFinite(n) || n <= 0) {
          console.error("candidateCount must be a positive number.");
          process.exit(1);
        }
        if (n < topK) {
          console.error(`candidateCount must be >= topK (${topK}).`);
          process.exit(1);
        }
        manager.updateProjectSetting("rag", {
          ...(project.rag || {}),
          candidateCount: Math.floor(n),
        });
        break;
      }
      case "project.rag.extractor": {
  const v = trimmed.toLowerCase();
  if (v !== "native" && v !== "sqlite-rag") {
    console.error("extractor must be one of: native, sqlite-rag");
    process.exit(1);
  }
  manager.updateProjectSetting("rag", {
    ...(project.rag || {}),
    extractor: v as "native" | "sqlite-rag",
  });
  break;
}
case "project.rag.python": {
  manager.updateProjectSetting("rag", { ...(project.rag || {}), python: trimmed });
  break;
}case "user.embeddings.model":
        manager.updateUserSetting("embeddings", {
          ...(user.embeddings || {}),
          model: trimmed,
        });
        break;
      case "user.embeddings.baseURL":
        if (trimmed === "__same_as_baseURL__") {
          manager.updateUserSetting("embeddings", {
            ...(user.embeddings || {}),
            baseURL: undefined,
          });
          break;
        }
        manager.updateUserSetting("embeddings", {
          ...(user.embeddings || {}),
          baseURL: trimmed,
        });
        break;
      case "project.rag.embeddings.model":
        manager.updateProjectSetting("rag", {
          ...(project.rag || {}),
          embeddings: {
            ...((project.rag || {}).embeddings || {}),
            model: trimmed,
          },
        });
        break;
      case "project.rag.embeddings.baseURL":
        if (trimmed === "__same_as_baseURL__") {
          manager.updateProjectSetting("rag", {
            ...(project.rag || {}),
            embeddings: {
              ...((project.rag || {}).embeddings || {}),
              baseURL: undefined,
            },
          });
          break;
        }
        manager.updateProjectSetting("rag", {
          ...(project.rag || {}),
          embeddings: {
            ...((project.rag || {}).embeddings || {}),
            baseURL: trimmed,
          },
        });
        break;
      case "user.morphApiKey":
        manager.updateUserSetting("morphApiKey", trimmed);
        break;
      default:
        console.error(`Setting not implemented yet: ${key}`);
        process.exit(1);
    }

    console.log(`✓ Saved ${key}`);
  });

configCommand
  .command("init")
  .description("Initialize template config files if missing")
  .action(() => {
    const manager = getSettingsManager();
    // Ensure user settings exist (will create defaults if missing)
    manager.loadUserSettings();
    // Ensure project settings exist (will create defaults if missing)
    manager.loadProjectSettings();

    const ragIgnorePath = path.join(process.cwd(), ".grok", "ragignore");
    if (!fs.existsSync(ragIgnorePath)) {
      fs.mkdirSync(path.dirname(ragIgnorePath), { recursive: true });
      fs.writeFileSync(
        ragIgnorePath,
        [
          "# .grok/ragignore",
          "# One rule per line. v1 semantics: simple substring match on relative paths.",
          "node_modules/",
          "dist/",
          "build/",
          ".git/",
        ].join("\n") + "\n"
      );
      console.log(`✓ Created ${ragIgnorePath}`);
    } else {
      console.log(`✓ ${ragIgnorePath} already exists`);
    }
    console.log("✓ Config initialized");
  });

program.parse();

// ADID_ROLLBACK (from adm.exe)
// SDID_ROLLBACK {
//   "target_file": "D:\\zPython\\grok-cli\\src/index.ts"
//   "update_script": "adm.exe"
//   "backup_path": "D:\\zPython\\grok-cli\\src/index.ts.backup_20260216T224756_784916"
//   "created_at": "2026-02-16T14:47:56.832107+00:00"
//   "backup_hash": "50122f00ce958cae9715e31f1d08c9a3"
//   "new_hash": "9cb5d121fc6bef5845ec9df656df17c6"
//   "goal_id": "cli_config_set_rag_extractor_insert"
//   "semantics": "Implement config set for new project RAG keys."
//   "update_attrs": {"relative_path": "src/index.ts", "update_type": "text", "mode": "insert", "encoding": "utf-8", "find_pattern": null, "find_text": "case \"user.embeddings.model\":", "replace_present": true}
//   "restore_cmd": "uv run adm --rollback \"D:\\zPython\\grok-cli\\src/index.ts\""
// }
