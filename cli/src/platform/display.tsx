/**
 * Display utilities: ASCII logo, spinners, and progress indicators.
 *
 * All output respects NO_COLOR.  The logo is printed once at interactive
 * session startup.  Spinners are React/Ink components used in the REPL.
 */

import { Box, Text } from "ink";
import React from "react";

const NO_COLOR = Boolean(process.env.NO_COLOR);

// ---------------------------------------------------------------------------
// ASCII logo
// ---------------------------------------------------------------------------

const LOGO_LINES = [
  "  ██████╗ █████╗ ██╗██████╗ ███████╗",
  " ██╔════╝██╔══██╗██║██╔══██╗██╔════╝",
  " ██║     ███████║██║██████╔╝█████╗  ",
  " ██║     ██╔══██║██║██╔═══╝ ██╔══╝  ",
  " ╚██████╗██║  ██║██║██║     ███████╗",
  "  ╚═════╝╚═╝  ╚═╝╚═╝╚═╝     ╚══════╝",
];

const TAGLINE = "AI-assisted coding, workflows, and platform engineering";
const VERSION_COLOR = NO_COLOR ? "" : "\x1b[90m";
const CYAN = NO_COLOR ? "" : "\x1b[96m";
const RESET = NO_COLOR ? "" : "\x1b[0m";

/**
 * Print the CAIPE ASCII logo to stdout.
 * Called once when an interactive chat session starts.
 */
export function printLogo(version: string): void {
  if (NO_COLOR) {
    process.stdout.write("CAIPE\n");
    process.stdout.write(`${TAGLINE}\n\n`);
    return;
  }
  process.stdout.write("\n");
  for (const line of LOGO_LINES) {
    process.stdout.write(`${CYAN}${line}${RESET}\n`);
  }
  process.stdout.write(`\n  ${TAGLINE}\n`);
  process.stdout.write(`  ${VERSION_COLOR}v${version}${RESET}\n\n`);
}

// ---------------------------------------------------------------------------
// Ink spinner component
// ---------------------------------------------------------------------------

/**
 * CAIPE's unique spinner frames — rotating beacon quarters.
 * Evokes a "processing / broadcasting" feel for platform engineering.
 */
const CAIPE_SPINNER_FRAMES = ["◐", "◓", "◑", "◒"];
const SPINNER_PLAIN = ["-", "\\", "|", "/"];

export interface SpinnerProps {
  /** Label shown next to the spinner */
  label: string;
  /** Override the default cyan color */
  color?: string;
}

/**
 * Animated Ink spinner component using CAIPE's unique beacon frames.
 * Falls back to ASCII when NO_COLOR is set.
 */
export function Spinner({ label, color = "cyan" }: SpinnerProps): React.ReactElement {
  const { useState, useEffect } = React;
  const frames = NO_COLOR ? SPINNER_PLAIN : CAIPE_SPINNER_FRAMES;
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setFrame((f) => (f + 1) % frames.length);
    }, 250);
    return () => clearInterval(id);
  }, [frames.length]);

  return (
    <Box>
      <Text color={NO_COLOR ? undefined : color}>{frames[frame]} </Text>
      <Text>{label}</Text>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Streaming status spinner
// ---------------------------------------------------------------------------

export interface StreamingSpinnerProps {
  /** Action label, e.g. "Generating", "Thinking" */
  label?: string;
  /** Elapsed seconds since streaming began */
  elapsed: number;
  /** Tokens received so far in this response */
  tokenCount: number;
}

/**
 * Claude Code-style streaming status line:
 *   ◐ Generating… (12s · ↓ 541 tokens)
 *
 * Uses CAIPE's unique beacon spinner frames.
 */
export function StreamingSpinner({
  label = "Generating",
  elapsed,
  tokenCount,
}: StreamingSpinnerProps): React.ReactElement {
  const { useState, useEffect } = React;
  const frames = NO_COLOR ? SPINNER_PLAIN : CAIPE_SPINNER_FRAMES;
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setFrame((f) => (f + 1) % frames.length);
    }, 250);
    return () => clearInterval(id);
  }, [frames.length]);

  const tokenStr =
    tokenCount >= 1000 ? `↓ ${(tokenCount / 1000).toFixed(1)}k tokens` : `↓ ${tokenCount} tokens`;

  return (
    <Box>
      <Text color={NO_COLOR ? undefined : "blue"}>{frames[frame]} </Text>
      <Text color={NO_COLOR ? undefined : "blue"}>{label}… </Text>
      <Text dimColor>
        ({elapsed}s · {tokenStr})
      </Text>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Progress bar component
// ---------------------------------------------------------------------------

export interface ProgressBarProps {
  /** Value between 0 and 1 */
  progress: number;
  /** Bar width in characters */
  width?: number;
  label?: string;
}

export function ProgressBar({ progress, width = 30, label }: ProgressBarProps): React.ReactElement {
  const filled = Math.round(Math.max(0, Math.min(1, progress)) * width);
  const empty = width - filled;
  const bar = "█".repeat(filled) + "░".repeat(empty);
  const pct = `${Math.round(progress * 100)}%`;

  return (
    <Box>
      <Text color={NO_COLOR ? undefined : "cyan"}>[{bar}]</Text>
      <Text> {pct}</Text>
      {label !== undefined && <Text dimColor> {label}</Text>}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Status dots
// ---------------------------------------------------------------------------

/**
 * Returns a colored status indicator character.
 *   available  → green ●
 *   degraded   → yellow ●
 *   unavailable → red ●
 */
export function statusDot(available: boolean | "degraded"): string {
  if (NO_COLOR) return available ? "[ok]" : "[x]";
  if (available === true) return "\x1b[32m●\x1b[0m";
  if (available === "degraded") return "\x1b[33m●\x1b[0m";
  return "\x1b[31m●\x1b[0m";
}
