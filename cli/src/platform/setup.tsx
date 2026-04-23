/**
 * First-run setup wizard.
 *
 * Prompts the user for their caipe-ui URL (auth / OAuth proxy, e.g.
 * https://caipe.your-company.com) and saves it to settings.auth.url.
 * The A2A backend URL (settings.server.url / CAIPE_SERVER_URL) is optional
 * and can be set later via `caipe config set server.url <url>`.
 *
 * Called automatically by the chat runner when getAuthUrl() throws
 * ServerNotConfigured in interactive mode.  In headless mode the error
 * propagates and the process exits 1.
 */

import { Box, Text, useApp, useInput } from "ink";
import { render } from "ink";
import React, { useState } from "react";
import { readSettings, writeSettings } from "./config.js";

// ---------------------------------------------------------------------------
// Ink wizard component
// ---------------------------------------------------------------------------

interface WizardProps {
  onDone: (url: string) => void;
}

function SetupWizard({ onDone }: WizardProps): React.ReactElement {
  const { exit } = useApp();
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  useInput((char, key) => {
    if (key.return) {
      const url = input.trim().replace(/\/+$/, "");
      const isLocalhost = url.startsWith("http://localhost") || url.startsWith("http://127.0.0.1");
      if (!url.startsWith("https://") && !isLocalhost) {
        setError("URL must start with https:// (or http://localhost for local dev)");
        return;
      }
      if (url.includes("example.com") || url.includes("your-company")) {
        setError("Please enter your actual CAIPE server URL, not the example.");
        return;
      }
      setError(null);
      const settings = readSettings();
      settings.auth = { ...settings.auth, url };
      settings.setup = { completed: true };
      writeSettings(settings);
      onDone(url);
      exit();
      return;
    }
    if (key.backspace || key.delete) {
      setInput((prev) => prev.slice(0, -1));
      return;
    }
    if (key.ctrl && char === "c") {
      process.stderr.write("\n[ERROR] Setup cancelled.\n");
      process.exit(1);
    }
    if (!key.ctrl && !key.meta && char) {
      setInput((prev) => prev + char);
    }
  });

  return (
    <Box flexDirection="column" marginY={1}>
      <Text bold color="cyan">
        Welcome to CAIPE CLI — First-time Setup
      </Text>
      <Box marginTop={1}>
        <Text>Enter your caipe-ui URL (e.g. https://caipe.your-company.com): </Text>
      </Box>
      <Box>
        <Text color="green">{input}</Text>
        <Text color="gray">█</Text>
      </Box>
      {error !== null && (
        <Box marginTop={1}>
          <Text color="red">{error}</Text>
        </Box>
      )}
      <Box marginTop={1}>
        <Text dimColor>Press Enter to confirm. Ctrl+C to cancel.</Text>
      </Box>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Runs the interactive first-run wizard.
 * Returns the HTTPS server URL after it has been saved to settings.json.
 */
export async function runSetupWizard(): Promise<string> {
  return new Promise<string>((resolve) => {
    let resolved = false;
    const { unmount } = render(
      React.createElement(SetupWizard, {
        onDone: (url: string) => {
          resolved = true;
          unmount();
          resolve(url);
        },
      }),
    );
    // Safety: if process exits before resolution we just let it go
    void resolved;
    void unmount;
  });
}
