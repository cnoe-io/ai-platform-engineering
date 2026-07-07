/**
 * Headless session orchestrator.
 *
 * Resolves credentials → reads prompt → streams response → exits.
 * Supports single-shot and --interactive-stdin multi-turn modes.
 */
// assisted-by claude code claude-sonnet-4-6

import { readFileSync } from "node:fs";
import { fetchAgents, getAgent } from "../agents/registry.js";
import { DEFAULT_AGENT } from "../agents/types.js";
import { buildSystemContext } from "../chat/context.js";
import { createSession } from "../chat/history.js";
import { createAdapter } from "../chat/stream.js";
import { authEndpoints, getAuthUrl, getServerUrl } from "../platform/config.js";
import { resolveHeadlessCredentials } from "./auth.js";
import { type OutputFormat, createOutputWriter } from "./output.js";

export interface HeadlessOpts {
  token?: string;
  prompt?: string;
  promptFile?: string;
  output: OutputFormat;
  interactiveStdin: boolean;
  agentName: string;
  noContext?: boolean;
  urlOverride?: string;
}

export async function runHeadless(opts: HeadlessOpts): Promise<void> {
  const authUrl = (() => {
    try {
      return getAuthUrl(opts.urlOverride);
    } catch {
      emitError(
        "No CAIPE auth URL configured. Set CAIPE_AUTH_URL or run `caipe config set auth.url <url>`.",
      );
      process.exit(1);
    }
  })();

  let serverUrl: string;
  try {
    serverUrl = getServerUrl(opts.urlOverride);
  } catch {
    serverUrl = authUrl;
  }

  // Resolve credentials
  const credentials = await resolveHeadlessCredentials(opts.token, authUrl);
  if (!credentials) {
    emitError(
      "No credentials configured for headless mode. " +
        "Set CAIPE_TOKEN, CAIPE_API_KEY, or CAIPE_CLIENT_ID+CAIPE_CLIENT_SECRET.",
    );
    process.exit(1);
  }

  const getToken = async () => credentials.accessToken;

  // Resolve agent from registry when a name is specified
  let resolvedAgent = DEFAULT_AGENT;
  if (opts.agentName && opts.agentName !== "default") {
    try {
      const agents = await fetchAgents(serverUrl, getToken);
      const found = getAgent(agents, opts.agentName);
      if (found) resolvedAgent = found;
    } catch {
      // registry unavailable — continue with default
    }
  }

  const ep = authEndpoints(serverUrl);
  const adapter = createAdapter(resolvedAgent, ep.streamStart, getToken);
  const writer = createOutputWriter(opts.output);

  const cwd = process.cwd();
  const systemContext = await buildSystemContext(cwd, opts.noContext ?? false, {
    serverUrl,
    getToken,
  });
  const session = createSession({
    agentName: resolvedAgent.name,
    workingDir: cwd,
    headless: true,
    outputFormat: opts.output,
  });

  if (opts.interactiveStdin) {
    // Multi-turn: read lines from stdin until EOF or \exit
    for await (const line of stdinLines()) {
      if (line.trim() === "\\exit" || line.trim() === "/exit") break;
      await runSingleTurn(line, session, adapter, systemContext, writer, resolvedAgent.name);
    }
    writer.flush(resolvedAgent.name);
  } else {
    // Single-shot
    const prompt = await resolvePrompt(opts);
    await runSingleTurn(prompt, session, adapter, systemContext, writer, resolvedAgent.name);
    writer.flush(resolvedAgent.name);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function runSingleTurn(
  prompt: string,
  session: ReturnType<typeof createSession>,
  adapter: ReturnType<typeof createAdapter>,
  systemContext: string,
  writer: ReturnType<typeof createOutputWriter>,
  agentName: string,
): Promise<void> {
  try {
    for await (const event of adapter.connect({
      prompt,
      systemContext,
      sessionId: session.sessionId,
      agentName,
    })) {
      writer.write(event);
      if (event.type === "done" || event.type === "error" || event.type === "interrupted") break;
    }
  } catch (err) {
    emitError(String(err));
    process.exit(4);
  }
}

async function resolvePrompt(opts: HeadlessOpts): Promise<string> {
  if (opts.prompt) return opts.prompt;

  if (opts.promptFile) {
    try {
      return readFileSync(opts.promptFile, "utf8");
    } catch (err) {
      emitError(`Could not read prompt file: ${String(err)}`);
      process.exit(1);
    }
  }

  // Read from stdin pipe
  return readStdinAll();
}

async function readStdinAll(): Promise<string> {
  return new Promise((resolve) => {
    let buf = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk: string) => {
      buf += chunk;
    });
    process.stdin.on("end", () => resolve(buf.trim()));
    process.stdin.resume();
  });
}

async function* stdinLines(): AsyncIterable<string> {
  const rl = (await import("node:readline")).createInterface({ input: process.stdin });
  for await (const line of rl) {
    yield line;
  }
}

function emitError(message: string): void {
  process.stderr.write(`${JSON.stringify({ error: message })}\n`);
}
