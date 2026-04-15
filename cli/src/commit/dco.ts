/**
 * DCO commit assistance (T038).
 *
 * - buildCommitMessage(): append Assisted-by trailer
 * - promptSignedOffBy(): pre-fill from git config; never generate on user's behalf
 * - applyCommit(): git commit via execa
 * - installHook(): write prepare-commit-msg hook
 */

import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execa } from "execa";
import type { GitUser } from "../platform/git.js";

// Read model version from env (set at build time) or fallback
const MODEL_VERSION = process.env.CAIPE_MODEL_VERSION ?? "claude-sonnet-4-6";

// ---------------------------------------------------------------------------
// buildCommitMessage
// ---------------------------------------------------------------------------

/**
 * Append `Assisted-by: Claude:<model-version>` to a commit message draft.
 * Adds a blank line before the trailer if needed.
 */
export function buildCommitMessage(draft: string, modelVersion?: string): string {
  const version = modelVersion ?? MODEL_VERSION;
  const trailer = `Assisted-by: Claude:${version}`;

  // Already present?
  if (draft.includes(trailer)) return draft;

  // Ensure blank line before trailers
  const body = draft.trimEnd();
  const lastLine = body.split("\n").pop() ?? "";
  const separator = lastLine.trim() === "" ? "" : "\n\n";

  return `${body}${separator}${trailer}\n`;
}

// ---------------------------------------------------------------------------
// promptSignedOffBy
// ---------------------------------------------------------------------------

/**
 * Prompt the user for a Signed-off-by line.
 * Pre-fills from git user config but never generates it automatically.
 * Returns the signed-off line, or null if user declined.
 */
export async function promptSignedOffBy(gitUser: GitUser): Promise<string | null> {
  const suggestion = gitUser.email ? `Signed-off-by: ${gitUser.name} <${gitUser.email}>` : null;

  if (suggestion) {
    process.stdout.write("\nSigned-off-by (Enter to use, Ctrl+C to skip):\n");
    process.stdout.write(`  Suggestion: ${suggestion}\n`);
    process.stdout.write("> ");
  } else {
    process.stdout.write("\nSigned-off-by (Enter name <email>, or Enter to skip):\n");
    process.stdout.write("> ");
  }

  const raw = await readLine();
  const trimmed = raw.trim();

  if (trimmed === "" && suggestion !== null) return suggestion;
  if (trimmed === "") return null;
  if (!trimmed.startsWith("Signed-off-by:")) {
    return `Signed-off-by: ${trimmed}`;
  }
  return trimmed;
}

// ---------------------------------------------------------------------------
// applyCommit
// ---------------------------------------------------------------------------

/**
 * Run `git commit -m <message>` in the given repo root.
 */
export async function applyCommit(message: string, repoRoot: string): Promise<void> {
  await execa("git", ["commit", "-m", message], {
    cwd: repoRoot,
    stdio: "inherit",
  });
}

// ---------------------------------------------------------------------------
// installHook
// ---------------------------------------------------------------------------

const HOOK_CONTENT = `#!/bin/sh
# CAIPE prepare-commit-msg hook
# Appends Assisted-by trailer if caipe commit is detected.
COMMIT_MSG_FILE="$1"
COMMIT_SOURCE="$2"

# Only run on normal commits (not merges, squashes, etc.)
if [ -z "$COMMIT_SOURCE" ]; then
  MODEL="\${CAIPE_MODEL_VERSION:-claude-sonnet-4-6}"
  TRAILER="Assisted-by: Claude:$MODEL"
  if ! grep -qF "$TRAILER" "$COMMIT_MSG_FILE"; then
    printf "\\n%s\\n" "$TRAILER" >> "$COMMIT_MSG_FILE"
  fi
fi
`;

/**
 * Write the prepare-commit-msg hook to <repoRoot>/.git/hooks/.
 * Overwrites if present.
 */
export function installHook(repoRoot: string): void {
  const hooksDir = join(repoRoot, ".git", "hooks");
  if (!existsSync(hooksDir)) {
    mkdirSync(hooksDir, { recursive: true });
  }

  const hookPath = join(hooksDir, "prepare-commit-msg");
  writeFileSync(hookPath, HOOK_CONTENT, "utf8");
  chmodSync(hookPath, 0o755);
  process.stdout.write(`Installed prepare-commit-msg hook at ${hookPath}\n`);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
