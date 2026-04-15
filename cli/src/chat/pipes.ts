/**
 * Input parsing for pipe (`| cmd`) and shell escape (`! cmd`) syntax.
 *
 * Allows users to:
 *   - Pipe agent responses through shell commands: `explain pods | grep nginx`
 *   - Run shell commands inline: `! kubectl get pods`
 */

import { spawn } from "node:child_process";

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

export interface ParsedInput {
  /** The prompt to send to the agent (empty string for shell escapes) */
  prompt: string;
  /** Shell command to pipe agent output through (e.g. "grep nginx") */
  pipeCmd?: string;
  /** Shell escape command (e.g. "kubectl get pods") */
  shellCmd?: string;
}

/**
 * Parse user input for pipe and shell escape syntax.
 *
 * - `! <cmd>`          → shell escape, run cmd directly
 * - `<prompt> | <cmd>` → send prompt to agent, pipe output through cmd
 * - `<prompt>`         → plain prompt, no pipe
 *
 * Pipe detection avoids false positives: only splits on ` | ` (space-pipe-space)
 * at the top level, not inside quotes.
 */
export function parseInput(raw: string): ParsedInput {
  const trimmed = raw.trim();

  // Shell escape: starts with !
  if (trimmed.startsWith("!")) {
    const cmd = trimmed.slice(1).trim();
    return { prompt: "", shellCmd: cmd || undefined };
  }

  // Pipe: find last ` | ` not inside quotes
  const pipeIdx = findTopLevelPipe(trimmed);
  if (pipeIdx !== -1) {
    const prompt = trimmed.slice(0, pipeIdx).trim();
    const pipeCmd = trimmed.slice(pipeIdx + 1).trim();
    if (prompt && pipeCmd) {
      return { prompt, pipeCmd };
    }
  }

  return { prompt: trimmed };
}

/**
 * Find the index of the last top-level `|` character (preceded and followed by space).
 * Returns -1 if not found.
 */
function findTopLevelPipe(input: string): number {
  let inSingle = false;
  let inDouble = false;
  let lastPipe = -1;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === "|" && !inSingle && !inDouble) {
      // Check for space before and after (or end of string)
      const before = i > 0 ? input[i - 1] : " ";
      const after = i < input.length - 1 ? input[i + 1] : " ";
      if (before === " " && (after === " " || after === undefined)) {
        lastPipe = i;
      }
    }
  }

  return lastPipe;
}

// ---------------------------------------------------------------------------
// Shell execution
// ---------------------------------------------------------------------------

/**
 * Run a shell command and return its output.
 */
export async function runShellCommand(
  cmd: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const child = spawn("sh", ["-c", cmd], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });
    child.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });

    child.on("error", (err) => {
      resolve({ stdout: "", stderr: String(err), exitCode: 1 });
    });
  });
}

/**
 * Pipe text through a shell command and return the filtered output.
 */
export async function pipeThrough(text: string, cmd: string): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn("sh", ["-c", cmd], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });
    child.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    child.on("close", () => {
      resolve(stderr ? `${stdout}\n[stderr] ${stderr}`.trim() : stdout.trim());
    });

    child.on("error", (err) => {
      resolve(`[pipe error] ${String(err)}`);
    });

    child.stdin.write(text);
    child.stdin.end();
  });
}
