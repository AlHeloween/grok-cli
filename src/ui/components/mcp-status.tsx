import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";
import { getMCPManager } from "../../grok/tools.js";
import { MCPTool } from "../../mcp/client.js";
import { useTheme } from "../context/theme-context.js";

interface MCPStatusProps {
  /** Reserved for future props */
}

export function MCPStatus(_props: MCPStatusProps) {
  const { theme } = useTheme();
  const colors = theme.colors;
  const [connectedServers, setConnectedServers] = useState<string[]>([]);
  const [_availableTools, setAvailableTools] = useState<MCPTool[]>([]);

  useEffect(() => {
    const updateStatus = () => {
      try {
        const manager = getMCPManager();
        const servers = manager.getServers();
        const tools = manager.getTools();

        setConnectedServers(servers);
        setAvailableTools(tools);
      } catch {
        // MCP manager not initialized yet
        setConnectedServers([]);
        setAvailableTools([]);
      }
    };

    // Initial update with a small delay to allow MCP initialization
    const initialTimer = setTimeout(updateStatus, 10000);

    // Set up polling to check for status changes
    const interval = setInterval(updateStatus, 10000);

    return () => {
      clearTimeout(initialTimer);
      clearInterval(interval);
    };
  }, []);

  if (connectedServers.length === 0) {
    return null;
  }

  return (
    <Box marginLeft={1}>
      <Text color={colors.success}>⚒ mcps: {connectedServers.length} </Text>
    </Box>
  );
}
