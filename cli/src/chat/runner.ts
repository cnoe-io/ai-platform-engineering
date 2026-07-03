/**
 * caipe chat command runner.
 *
 * Handles both interactive (Ink REPL) and headless (no TTY) modes.
 * All streaming uses AG-UI via /api/v1/chat/stream/start on the caipe-ui BFF.
 */
// assisted-by claude code claude-sonnet-4-6

import { render } from "ink";
import React from "react";

import { DEFAULT_AGENT } from "../agents/types.js";
import { getValidToken } from "../auth/tokens.js";
import {
  ServerNotConfigured,
  authEndpoints,
  getAuthUrl,
  getServerUrl,
} from "../platform/config.js";
import { printLogo } from "../platform/display.js";
import { checkForUpdate, printUpdateBanner } from "../platform/updater.js";
import { runSetupWizard } from "../platform/setup.js";
import { Repl } from "./Repl.js";
import { buildSystemContext } from "./context.js";
import { createSession, saveSession } from "./history.js";
import type { ChatSession } from "./history.js";
import { createAdapter } from "./stream.js";

// Read version lazily
let _version = "0.1.0";
try {
  const { createRequire } = await import("node:module");
  const _req = createRequire(import.meta.url);
  const pkg = _req("../../package.json") as { version: string };
  _version = pkg.version;
} catch {
  /* ignore */
}

interface ChatOpts {
  agent?: string;
  noContext?: boolean;
  resume?: string;
  headless?: boolean;
  token?: string;
  prompt?: string;
  promptFile?: string;
  output?: string;
  interactiveStdin?: boolean;
}

interface GlobalOpts {
  url?: string;
  agent?: string;
}

export async function runChat(opts: ChatOpts, globalOpts: GlobalOpts): Promise<void> {
  const isHeadless = !process.stdout.isTTY || opts.headless === true;

  // In headless mode, delegate entirely to the headless runner
  if (isHeadless) {
    const { runHeadless } = await import("../headless/runner.js");
    await runHeadless({
      token: opts.token,
      prompt: opts.prompt,
      promptFile: opts.promptFile,
      output: (opts.output as "text" | "json" | "ndjson") ?? "text",
      interactiveStdin: opts.interactiveStdin ?? false,
      agentName: opts.agent ?? globalOpts.agent ?? "default",
      noContext: opts.noContext ?? false,
    });
    return;
  }

  // ── Interactive mode ────────────────────────────────────────────────────

  // Resolve auth (caipe-ui/OAuth) URL
  let authUrl: string;
  try {
    authUrl = getAuthUrl(globalOpts.url);
  } catch (err) {
    if (err instanceof ServerNotConfigured) {
      authUrl = await runSetupWizard();
    } else {
      throw err;
    }
  }

  // Kick off update check in background — non-blocking
  const updateCheckPromise = checkForUpdate(_version);

  // Ensure user is authenticated before opening the REPL
  const tokens = await import("../auth/tokens.js");
  const keychain = await import("../auth/keychain.js");
  const existing = await keychain.loadTokens();
  if (!existing || tokens.isExpired(existing)) {
    const { loginBrowser } = await import("../auth/oauth.js");
    process.stdout.write("You need to log in first.\n");
    await loginBrowser(authUrl, "caipe-cli");
  }

  // Print logo, then show update banner if one is available
  printLogo(_version);
  const latestVersion = await updateCheckPromise;
  if (latestVersion) printUpdateBanner(_version, latestVersion);

  // Resolve agent
  const agentName = opts.agent ?? globalOpts.agent ?? "default";

  // Gather context
  const cwd = process.cwd();
  const systemContext = await buildSystemContext(cwd, opts.noContext ?? false);

  // Create or resume session
  let session: ChatSession;
  if (opts.resume) {
    const { loadSession, createSession: makeSession } = await import("./history.js");
    const existing = loadSession(opts.resume);
    session = existing ?? makeSession({ agentName, workingDir: cwd });
  } else {
    session = createSession({ agentName, workingDir: cwd });
    session.memoryContext = systemContext;
  }

  // Stream endpoint: caipe-ui BFF (may differ from authUrl when KC is separate)
  let serverUrl: string;
  try {
    serverUrl = getServerUrl(globalOpts.url);
  } catch {
    serverUrl = authUrl; // fallback: single-URL setup
  }
  const ep = authEndpoints(serverUrl);
  const adapter = createAdapter(DEFAULT_AGENT, ep.streamStart, () =>
    getValidToken(authUrl),
  );

  // Mount REPL
  return new Promise<void>((resolve) => {
    const { unmount } = render(
      React.createElement(Repl, {
        session,
        adapter,
        systemContext,
        serverUrl: serverUrl,
        onExit: (finalSession: ChatSession) => {
          saveSession(finalSession);
          unmount();
          resolve();
        },
      }),
    );
  });
}

async function readLine(): Promise<string> {
  return new Promise((resolve) => {
    let buf = "";
    const onData = (chunk: Buffer) => {
      buf += chunk.toString();
      const nl = buf.indexOf("\n");
      if (nl !== -1) {
        process.stdin.off("data", onData);
        process.stdin.pause();
        resolve(buf.slice(0, nl));
      }
    };
    process.stdin.resume();
    process.stdin.on("data", onData);
  });
}

void readLine; // keep for potential future use
