/**
 * `caipe diff` — git diff summary for the current repo.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

export async function runDiff(opts: { stat?: boolean }): Promise<void> {
  const cwd = process.cwd();
  if (!existsSync(join(cwd, ".git"))) {
    process.stderr.write("[ERROR] Not a git repository.\n");
    process.exit(3);
  }

  const args = opts.stat === false ? ["diff"] : ["diff", "--stat"];
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.error) {
    process.stderr.write(`[ERROR] ${result.error.message}\n`);
    process.exit(4);
  }
  process.stdout.write(result.stdout || "(no changes)\n");
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status && result.status > 1) process.exit(result.status);
}
