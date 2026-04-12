/**
 * Command handler for `caipe commit [--install-hook]`.
 */

import { findRepoRoot, stagedFiles, gitUser } from "../platform/git.js";
import {
  buildCommitMessage,
  promptSignedOffBy,
  applyCommit,
  installHook,
} from "./dco.js";

export async function runCommit(opts: { installHook?: boolean }): Promise<void> {
  const cwd = process.cwd();
  const repoRoot = await findRepoRoot(cwd);

  if (!repoRoot) {
    process.stderr.write("[ERROR] Not inside a git repository.\n");
    process.exit(3);
  }

  if (opts.installHook) {
    installHook(repoRoot);
    return;
  }

  // Check for staged files
  const staged = await stagedFiles(repoRoot);
  if (staged.length === 0) {
    process.stderr.write(
      "[ERROR] No staged changes. Stage files with `git add` before committing.\n",
    );
    process.exit(3);
  }

  process.stdout.write(`Staged files (${staged.length}):\n`);
  for (const f of staged) {
    process.stdout.write(`  ${f}\n`);
  }

  // Get commit message
  process.stdout.write("\nCommit message (Ctrl+D or blank line to finish):\n> ");
  const rawMsg = await readMultiLine();
  if (!rawMsg.trim()) {
    process.stderr.write("[ERROR] Empty commit message. Aborting.\n");
    process.exit(3);
  }

  // Build message with Assisted-by trailer
  let message = buildCommitMessage(rawMsg);

  // Prompt for Signed-off-by
  const user = await gitUser(repoRoot);
  const sob = await promptSignedOffBy(user);

  if (sob !== null) {
    message = message.trimEnd() + `\n${sob}\n`;
  } else {
    process.stdout.write(
      "\n[WARNING] Proceeding without Signed-off-by. " +
        "You are responsible for certifying the DCO.\n",
    );
    process.stdout.write("Continue anyway? [y/N] ");
    const confirm = await readSingleLine();
    if (!confirm.trim().toLowerCase().startsWith("y")) {
      process.stdout.write("Aborted.\n");
      process.exit(0);
    }
  }

  // Show final message
  process.stdout.write(`\nFinal commit message:\n─────────────────\n${message}─────────────────\n`);
  process.stdout.write("Proceed? [y/N] ");
  const go = await readSingleLine();
  if (!go.trim().toLowerCase().startsWith("y")) {
    process.stdout.write("Aborted.\n");
    process.exit(0);
  }

  await applyCommit(message, repoRoot);
}

async function readMultiLine(): Promise<string> {
  return new Promise((resolve) => {
    let buf = "";
    const onData = (chunk: Buffer) => {
      buf += chunk.toString();
      // Finish on Ctrl+D (EOF) or double newline
      if (buf.endsWith("\n\n")) {
        process.stdin.off("data", onData);
        process.stdin.pause();
        resolve(buf.trim());
      }
    };
    process.stdin.resume();
    process.stdin.on("data", onData);
    process.stdin.on("end", () => {
      process.stdin.off("data", onData);
      resolve(buf.trim());
    });
  });
}

async function readSingleLine(): Promise<string> {
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
