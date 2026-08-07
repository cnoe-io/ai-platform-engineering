/**
 * `caipe local` — optional local Anthropic/LiteLLM chat with read/write/bash tools.
 */

import { createInterface } from "node:readline";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, relative } from "node:path";
import { spawnSync } from "node:child_process";

const MAX_READ = 100_000;

interface Message {
  role: "user" | "assistant";
  content: string | ContentBlock[];
}

type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string };

function apiConfig(): { baseUrl: string; apiKey: string; model: string } | null {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return null;
  const baseUrl = (process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com").replace(/\/+$/, "");
  const model = process.env.CAIPE_LOCAL_MODEL?.trim() || "claude-sonnet-4-20250514";
  return { baseUrl, apiKey, model };
}

function runBash(cwd: string, command: string): string {
  const result = spawnSync("bash", ["-lc", command], {
    cwd,
    encoding: "utf8",
    maxBuffer: 512 * 1024,
  });
  const out = (result.stdout ?? "") + (result.stderr ? `\n[stderr]\n${result.stderr}` : "");
  return out.trim() || `(exit ${result.status ?? 0})`;
}

function readTool(cwd: string, path: string): string {
  const abs = resolve(cwd, path);
  const rel = relative(cwd, abs);
  if (rel.startsWith("..")) return "Error: path outside working directory";
  if (!existsSync(abs)) return "Error: file not found";
  const text = readFileSync(abs, "utf8");
  return text.length > MAX_READ ? `${text.slice(0, MAX_READ)}\n...(truncated)` : text;
}

function writeTool(cwd: string, path: string, content: string): string {
  const abs = resolve(cwd, path);
  const rel = relative(cwd, abs);
  if (rel.startsWith("..")) return "Error: path outside working directory";
  writeFileSync(abs, content, "utf8");
  return `Wrote ${rel}`;
}

const TOOLS = [
  {
    name: "read_file",
    description: "Read a UTF-8 text file relative to the project root",
    input_schema: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
  },
  {
    name: "write_file",
    description: "Write a UTF-8 text file relative to the project root",
    input_schema: {
      type: "object",
      properties: { path: { type: "string" }, content: { type: "string" } },
      required: ["path", "content"],
    },
  },
  {
    name: "bash",
    description: "Run a shell command in the project directory",
    input_schema: {
      type: "object",
      properties: { command: { type: "string" } },
      required: ["command"],
    },
  },
];

async function callAnthropic(
  cfg: { baseUrl: string; apiKey: string; model: string },
  messages: Message[],
): Promise<Message> {
  const res = await fetch(`${cfg.baseUrl}/v1/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": cfg.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: cfg.model,
      max_tokens: 8192,
      messages,
      tools: TOOLS,
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Anthropic API HTTP ${res.status}: ${body.slice(0, 400)}`);
  }
  const json = (await res.json()) as { content: ContentBlock[]; stop_reason?: string };
  return { role: "assistant", content: json.content };
}

function textFromContent(content: string | ContentBlock[]): string {
  if (typeof content === "string") return content;
  return content
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text)
    .join("");
}

export async function runLocal(opts: { prompt?: string }): Promise<void> {
  const cfg = apiConfig();
  if (!cfg) {
    process.stderr.write(
      "[ERROR] Set ANTHROPIC_API_KEY (optional ANTHROPIC_BASE_URL for LiteLLM proxy).\n",
    );
    process.exit(3);
  }

  const cwd = process.cwd();
  const messages: Message[] = [
    {
      role: "user",
      content:
        "You are a coding assistant with read_file, write_file, and bash tools. Work in the user's project directory.",
    },
  ];

  const runTurn = async (userText: string): Promise<void> => {
    messages.push({ role: "user", content: userText });
    for (let step = 0; step < 12; step++) {
      const assistant = await callAnthropic(cfg, messages);
      messages.push(assistant);
      const blocks = Array.isArray(assistant.content) ? assistant.content : [];
      const toolUses = blocks.filter(
        (b): b is { type: "tool_use"; id: string; name: string; input: Record<string, unknown> } =>
          b.type === "tool_use",
      );
      const text = textFromContent(assistant.content);
      if (text) process.stdout.write(`\n${text}\n`);

      if (toolUses.length === 0) break;

      const results: ContentBlock[] = [];
      for (const tool of toolUses) {
        let out: string;
        if (tool.name === "read_file") {
          out = readTool(cwd, String(tool.input.path ?? ""));
        } else if (tool.name === "write_file") {
          out = writeTool(cwd, String(tool.input.path ?? ""), String(tool.input.content ?? ""));
        } else if (tool.name === "bash") {
          out = runBash(cwd, String(tool.input.command ?? ""));
        } else {
          out = `Unknown tool: ${tool.name}`;
        }
        process.stderr.write(`[tool] ${tool.name}\n`);
        results.push({ type: "tool_result", tool_use_id: tool.id, content: out });
      }
      messages.push({ role: "user", content: results });
    }
  };

  if (opts.prompt) {
    await runTurn(opts.prompt);
    return;
  }

  if (!process.stdin.isTTY) {
    process.stderr.write("[ERROR] Pipe a prompt with --prompt or use an interactive terminal.\n");
    process.exit(3);
  }

  process.stdout.write(`Local mode (${cfg.model}). Type /exit to quit.\n`);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed === "/exit") break;
    await runTurn(trimmed);
  }
}
