/**
 * Git subprocess wrappers via execa.
 *
 * All functions accept a `root` absolute path (repo root containing .git).
 * They throw if the command fails; callers catch and handle gracefully.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { execa } from "execa";

// ---------------------------------------------------------------------------
// Repo discovery
// ---------------------------------------------------------------------------

/**
 * Walk up from `cwd` until a `.git` directory is found.
 * Returns the repo root, or null if not inside a git repo.
 */
export async function findRepoRoot(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await execa("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      reject: false,
    });
    const root = stdout.trim();
    if (root && existsSync(join(root, ".git"))) return root;
    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// File tree sampling
// ---------------------------------------------------------------------------

/**
 * Returns a newline-delimited list of tracked+untracked files in the repo,
 * respecting .gitignore, capped at `maxFiles`.
 */
export async function sampleFileTree(root: string, maxFiles = 150): Promise<string> {
  try {
    // Tracked files
    const tracked = await execa("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
      cwd: root,
    });
    const lines = tracked.stdout.split("\n").filter(Boolean);
    const capped = lines.slice(0, maxFiles);
    if (lines.length > maxFiles) {
      capped.push(`... (${lines.length - maxFiles} more files not shown)`);
    }
    return capped.join("\n");
  } catch {
    return "(could not read file tree)";
  }
}

// ---------------------------------------------------------------------------
// Git log
// ---------------------------------------------------------------------------

/**
 * Returns the last `n` commits as one-line summaries: `<hash> <message>`.
 */
export async function recentLog(root: string, n = 20): Promise<string> {
  try {
    const { stdout } = await execa(
      "git",
      ["log", `--max-count=${n}`, "--pretty=format:%h %s", "--no-merges"],
      { cwd: root },
    );
    return stdout.trim() || "(no commits yet)";
  } catch {
    return "(could not read git log)";
  }
}

// ---------------------------------------------------------------------------
// Staged files
// ---------------------------------------------------------------------------

/**
 * Returns an array of staged file paths (relative to repo root).
 */
export async function stagedFiles(root: string): Promise<string[]> {
  try {
    const { stdout } = await execa(
      "git",
      ["diff", "--cached", "--name-only", "--diff-filter=ACMRDU"],
      { cwd: root },
    );
    return stdout.split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Git identity
// ---------------------------------------------------------------------------

export interface GitUser {
  name: string;
  email: string;
}

/**
 * Reads `git config user.name` and `git config user.email` from the repo.
 */
export async function gitUser(root: string): Promise<GitUser> {
  const [nameResult, emailResult] = await Promise.all([
    execa("git", ["config", "user.name"], { cwd: root, reject: false }),
    execa("git", ["config", "user.email"], { cwd: root, reject: false }),
  ]);
  return {
    name: nameResult.stdout.trim() || "Unknown",
    email: emailResult.stdout.trim() || "",
  };
}
