import React, { useState, useEffect, useRef } from "react";
import { Box, Text, type DOMElement } from "ink";
import { GrokAgent, ChatEntry } from "../../agent/grok-agent.js";
import { useInputHandler } from "../../hooks/use-input-handler.js";
import { LoadingSpinner } from "./loading-spinner.js";
import { CommandSuggestions } from "./command-suggestions.js";
import { ModelSelection } from "./model-selection.js";
import { ThemeSelection } from "./theme-selection.js";
import { ConfigMenu } from "./config-menu.js";
import { ChatHistory } from "./chat-history.js";
import { ChatInput } from "./chat-input.js";
import { MCPStatus } from "./mcp-status.js";
import { getSettingsManager } from "../../utils/settings-manager.js";
import ConfirmationDialog from "./confirmation-dialog.js";
import {
  ConfirmationService,
  ConfirmationOptions,
} from "../../utils/confirmation-service.js";
import ApiKeyInput from "./api-key-input.js";

import { useTheme } from "../context/theme-context.js";

interface ChatInterfaceProps {
  agent?: GrokAgent;
  initialMessage?: string;
  initialChatHistory?: ChatEntry[];
}

// Main chat component that handles input when agent is available
function ChatInterfaceWithAgent({
  agent,
  initialMessage,
  initialChatHistory,
}: {
  agent: GrokAgent;
  initialMessage?: string;
  initialChatHistory?: ChatEntry[];
}) {
  const { theme } = useTheme();
  const colors = theme.colors;
  const [chatHistory, setChatHistory] = useState<ChatEntry[]>(initialChatHistory || []);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingTime, setProcessingTime] = useState(0);
  const [tokenCount, setTokenCount] = useState(0);
  const [isStreaming, setIsStreaming] = useState(false);
  const [confirmationOptions, setConfirmationOptions] =
    useState<ConfirmationOptions | null>(null);
  const scrollRef = useRef<DOMElement>(null);
  const processingStartTime = useRef<number>(0);

  const confirmationService = ConfirmationService.getInstance();

  const {
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
    ragInputPrompt,
    commandSuggestions,
    availableModels,
    availableThemes,
    autoEditEnabled,
    lastKeyDebug,
    pendingImageCount,
  } = useInputHandler({
    agent,
    chatHistory,
    setChatHistory,
    setIsProcessing,
    setIsStreaming,
    setTokenCount,
    setProcessingTime,
    processingStartTime,
    isProcessing,
    isStreaming,
    isConfirmationActive: !!confirmationOptions,
  });

  
  // Process initial message if provided (streaming for faster feedback)
  useEffect(() => {
    if (initialMessage && agent) {
      const userEntry: ChatEntry = {
        type: "user",
        content: initialMessage,
        timestamp: new Date(),
      };
      setChatHistory([userEntry]);

      const processInitialMessage = async () => {
        setIsProcessing(true);
        setIsStreaming(true);

        try {
          let streamingEntry: ChatEntry | null = null;
          for await (const chunk of agent.processUserMessageStream(initialMessage)) {
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
        } catch (error: unknown) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          const errorEntry: ChatEntry = {
            type: "assistant",
            content: `Error: ${errorMessage}`,
            timestamp: new Date(),
          };
          setChatHistory((prev) => [...prev, errorEntry]);
          setIsStreaming(false);
        }

        setIsProcessing(false);
        processingStartTime.current = 0;
      };

      processInitialMessage();
    }
  }, [initialMessage, agent]);

  useEffect(() => {
    const handleConfirmationRequest = (options: ConfirmationOptions) => {
      setConfirmationOptions(options);
    };

    confirmationService.on("confirmation-requested", handleConfirmationRequest);

    return () => {
      confirmationService.off(
        "confirmation-requested",
        handleConfirmationRequest
      );
    };
  }, [confirmationService]);

  useEffect(() => {
    if (!isProcessing && !isStreaming) {
      setProcessingTime(0);
      return;
    }

    if (processingStartTime.current === 0) {
      processingStartTime.current = Date.now();
    }

    const interval = setInterval(() => {
      setProcessingTime(
        Math.floor((Date.now() - processingStartTime.current) / 1000)
      );
    }, 1000);

    return () => clearInterval(interval);
  }, [isProcessing, isStreaming]);

  const handleConfirmation = (dontAskAgain?: boolean) => {
    confirmationService.confirmOperation(true, dontAskAgain);
    setConfirmationOptions(null);
  };

  const handleRejection = (feedback?: string) => {
    confirmationService.rejectOperation(feedback);
    setConfirmationOptions(null);

    // Reset processing states when operation is cancelled
    setIsProcessing(false);
    setIsStreaming(false);
    setTokenCount(0);
    setProcessingTime(0);
    processingStartTime.current = 0;
  };

  return (
    <Box flexDirection="column" paddingX={2}>
  <Box marginBottom={1}>
    <Text color={colors.accent} bold>GROK</Text>
  </Box>
      {/* Show tips only when no chat history and no confirmation dialog */}
      {chatHistory.length === 0 && !confirmationOptions && (
        <Box flexDirection="column" marginBottom={2}>
          <Text color={colors.accent} bold>
            Tips for getting started:
          </Text>
          <Box marginTop={1} flexDirection="column">
            <Text color={colors.textDim}>
              1. Ask questions, edit files, or run commands.
            </Text>
            <Text color={colors.textDim}>2. Be specific for the best results.</Text>
            <Text color={colors.textDim}>
              3. Create GROK.md files to customize your interactions with Grok.
            </Text>
            <Text color={colors.textDim}>
              4. Press Shift+Tab to toggle auto-edit mode.
            </Text>
            <Text color={colors.textDim}>5. /help for more information.</Text>
          </Box>
        </Box>
      )}

      <Box flexDirection="column" marginBottom={1}>
        <Text color={colors.textDim}>
          Type your request in natural language. Ctrl+C to clear, 'exit' to
          quit.
        </Text>
      </Box>

      <Box flexDirection="column" ref={scrollRef}>
        <ChatHistory
          entries={chatHistory}
          isConfirmationActive={!!confirmationOptions}
        />
      </Box>

      {/* Show confirmation dialog if one is pending */}
      {confirmationOptions && (
        <ConfirmationDialog
          operation={confirmationOptions.operation}
          filename={confirmationOptions.filename}
          showVSCodeOpen={confirmationOptions.showVSCodeOpen}
          content={confirmationOptions.content}
          onConfirm={handleConfirmation}
          onReject={handleRejection}
        />
      )}

      {!confirmationOptions && (
        <>
          <LoadingSpinner
            isActive={isProcessing || isStreaming}
            processingTime={processingTime}
            tokenCount={tokenCount}
          />

          <ChatInput
            input={input}
            cursorPosition={cursorPosition}
            isProcessing={isProcessing}
            isStreaming={isStreaming}
            pendingImageCount={pendingImageCount}
            placeholderText={ragInputPrompt || configInputPrompt || undefined}
            maskInput={!!configInputMask}
          />

          <Box flexDirection="row" marginTop={1}>
            <Box marginRight={2}>
              <Text color={colors.accent}>
                {autoEditEnabled ? "▶" : "⏸"} auto-edit:{" "}
                {autoEditEnabled ? "on" : "off"}
              </Text>
              <Text color={colors.textDim} dimColor>
                {" "}
                (shift + tab)
              </Text>
            </Box>
            <Box marginRight={2}>
              <Text color={colors.warning}>≋ {agent.getCurrentModel()}</Text>
            </Box>
            <Box marginRight={2}>
              <Text color={colors.info}>
                RAG: {getSettingsManager().isRagEnabled() ? "on" : "off"} ({getSettingsManager().getEmbeddingsSettings().provider || "hash"})
              </Text>
            </Box>
            <MCPStatus />
          </Box>

          {process.env.GROK_DEBUG_INPUT && lastKeyDebug && (
  <Text color={colors.textDim} dimColor>
    {lastKeyDebug}
  </Text>
)}
<CommandSuggestions
            suggestions={commandSuggestions}
            input={input}
            selectedIndex={selectedCommandIndex}
            isVisible={showCommandSuggestions}
          />

          <ModelSelection
            models={availableModels}
            selectedIndex={selectedModelIndex}
            isVisible={showModelSelection}
            currentModel={agent.getCurrentModel()}
          />

          <ThemeSelection
            themes={availableThemes}
            selectedIndex={selectedThemeIndex}
            isVisible={showThemeSelection}
            currentThemeId={theme.id}
          />

          <ConfigMenu
            title={configMenuTitle}
            items={configMenuItems}
            selectedIndex={selectedConfigIndex}
            isVisible={showConfigMenu}
          />
        </>
      )}
    </Box>
  );
}

const MemoizedChatInterfaceWithAgent = React.memo(ChatInterfaceWithAgent);

// Main component that handles API key input or chat interface
export default function ChatInterface({
  agent,
  initialMessage,
  initialChatHistory,
}: ChatInterfaceProps) {
  const [currentAgent, setCurrentAgent] = useState<GrokAgent | null>(
    agent || null
  );

  const handleApiKeySet = (newAgent: GrokAgent) => {
    setCurrentAgent(newAgent);
  };

  if (!currentAgent) {
    return <ApiKeyInput onApiKeySet={handleApiKeySet} />;
  }

  return (
    <MemoizedChatInterfaceWithAgent
      agent={currentAgent}
      initialMessage={initialMessage}
      initialChatHistory={initialChatHistory}
    />
  );
}

// ADID_ROLLBACK (from adm.exe)
// SDID_ROLLBACK {
//   "target_file": "D:\\zPython\\grok-cli\\src/ui/components/chat-interface.tsx"
//   "update_script": "adm.exe"
//   "backup_path": "D:\\zPython\\grok-cli\\src/ui/components/chat-interface.tsx.backup_20260228T205242_375759"
//   "created_at": "2026-02-28T12:52:42.389909+00:00"
//   "backup_hash": "3a5cec6826a6b28bb9493a6a963808c3"
//   "new_hash": "be83d7d511989fa6bbbb8af4e59cbfe7"
//   "goal_id": "update_placeholder_text"
//   "semantics": ""
//   "update_attrs": {"relative_path": "src/ui/components/chat-interface.tsx", "update_type": "text", "mode": "replace", "encoding": "utf-8", "find_pattern": null, "find_text": "placeholderText={configInputPrompt || undefined}", "replace_present": true}
//   "restore_cmd": "uv run adm --rollback \"D:\\zPython\\grok-cli\\src/ui/components/chat-interface.tsx\""
// }
