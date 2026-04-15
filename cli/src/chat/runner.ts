/**
 * caipe chat command runner.
 *
 * Handles both interactive (Ink REPL) and headless (no TTY) modes.
 * Protocol validation against agent capabilities.
 * First-run setup wizard if no server URL configured.
 */

import { render } from "ink";
import React from "react";

import { DEFAULT_AGENT } from "../agents/types.js";
import { getValidToken } from "../auth/tokens.js";
import {
  ServerNotConfigured,
  authEndpoints,
  getA2aUrl,
  getAuthUrl,
  serverEndpoints,
} from "../platform/config.js";
import { discoverAgentConfig } from "../platform/discovery.js";
import { printLogo } from "../platform/display.js";
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
  protocol?: string;
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
      protocol: (opts.protocol as "a2a" | "agui") ?? "a2a",
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

  // Print logo on first render
  printLogo(_version);

  // Resolve agent
  const agentName = opts.agent ?? globalOpts.agent ?? "default";
  const protocol = (opts.protocol ?? "a2a") as "a2a" | "agui";

  // Optionally validate protocol against agent capabilities
  // (registry fetch is best-effort; don't block chat if registry is down)
  try {
    const { fetchAgents, validateProtocol } = await import("../agents/registry.js");
    const agents = await fetchAgents(authUrl, async () => getValidToken(authUrl));
    const agent = agents.find((a) => a.name === agentName);
    if (agent) {
      const validation = validateProtocol(agent, protocol);
      if (!validation.valid) {
        process.stdout.write(
          `\nAgent "${agentName}" does not support protocol "${protocol}" (supports: ${validation.supported.join(", ")}). Switch protocol and continue? [y/N] `,
        );
        const answer = await readLine();
        if (!answer.trim().toLowerCase().startsWith("y")) {
          process.stderr.write("[ERROR] Aborted — unsupported protocol.\n");
          process.exit(3);
        }
      }
    }
  } catch {
    // Registry unreachable — proceed with requested protocol
  }

  // Gather context
  const cwd = process.cwd();
  const systemContext = await buildSystemContext(cwd, opts.noContext ?? false);

  // Create or resume session
  let session: ChatSession;
  if (opts.resume) {
    const { loadSession, createSession: makeSession } = await import("./history.js");
    const existing = loadSession(opts.resume);
    session = existing ?? makeSession({ agentName, workingDir: cwd });
    session = { ...session, protocol };
  } else {
    session = createSession({ agentName, workingDir: cwd, protocol });
    session.memoryContext = systemContext;
  }

  // Discover endpoint from /.well-known/agent.json; fall back to derived paths.
  // Discovery uses the auth URL; A2A task endpoint may come from an explicit
  // CAIPE_SERVER_URL / settings.server.url override, otherwise from the agent card.
  const agentConfig = await discoverAgentConfig(authUrl);
  const a2aUrl = getA2aUrl();
  const authEp = authEndpoints(authUrl);
  const taskEndpoint =
    protocol === "agui"
      ? a2aUrl
        ? serverEndpoints(a2aUrl).aguiStream
        : authEp.aguiStream
      : (agentConfig.a2a?.endpoint ??
        (a2aUrl ? serverEndpoints(a2aUrl).a2aTask : authEp.aguiStream));

  // Create adapter
  const adapter = createAdapter(protocol, DEFAULT_AGENT, taskEndpoint, () =>
    getValidToken(authUrl),
  );

  // Mount REPL
  return new Promise<void>((resolve) => {
    const { unmount } = render(
      React.createElement(Repl, {
        session,
        adapter,
        systemContext,
        serverUrl: authUrl,
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
