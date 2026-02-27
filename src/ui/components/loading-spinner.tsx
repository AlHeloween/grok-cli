import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";
import { formatTokenCount } from "../../utils/token-counter.js";
import { useTheme } from "../context/theme-context.js";

interface LoadingSpinnerProps {
  isActive: boolean;
  processingTime: number;
  tokenCount: number;
}

const loadingTexts = [
  "Thinking...",
  "Computing...",
  "Analyzing...",
  "Processing...",
  "Calculating...",
  "Interfacing...",
  "Optimizing...",
  "Synthesizing...",
  "Decrypting...",
  "Calibrating...",
  "Bootstrapping...",
  "Synchronizing...",
  "Compiling...",
  "Downloading...",
];

export function LoadingSpinner({
  isActive,
  processingTime,
  tokenCount,
}: LoadingSpinnerProps) {
  const { theme } = useTheme();
  const colors = theme.colors;
  const [spinnerFrame, setSpinnerFrame] = useState(0);
  const [loadingTextIndex, setLoadingTextIndex] = useState(0);

  useEffect(() => {
    if (!isActive) return;

    const spinnerFrames = ["/", "-", "\\", "|"];
    // Reduced frequency: 1000ms instead of 500ms to reduce flickering on Windows
    const interval = setInterval(() => {
      setSpinnerFrame((prev) => (prev + 1) % spinnerFrames.length);
    }, 1000);

    return () => clearInterval(interval);
  }, [isActive]);

  useEffect(() => {
    if (!isActive) return;

    setLoadingTextIndex(Math.floor(Math.random() * loadingTexts.length));

    // Increased interval: 8s instead of 4s to reduce state changes
    const interval = setInterval(() => {
      setLoadingTextIndex(Math.floor(Math.random() * loadingTexts.length));
    }, 8000);

    return () => clearInterval(interval);
  }, [isActive]);

  if (!isActive) return null;

  const spinnerFrames = ["/", "-", "\\", "|"];

  return (
    <Box marginTop={1}>
      <Text color={colors.accent}>
        {spinnerFrames[spinnerFrame]} {loadingTexts[loadingTextIndex]}{" "}
      </Text>
      <Text color={colors.textDim}>
        ({processingTime}s · ↑ {formatTokenCount(tokenCount)} tokens · esc to
        interrupt)
      </Text>
    </Box>
  );
}
