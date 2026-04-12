/**
 * Command handler for `caipe memory [--global]` (T047).
 */

import { openMemoryFile } from "./editor.js";

export async function runMemory(opts: { global?: boolean }): Promise<void> {
  const cwd = process.cwd();
  const scope = opts.global === true ? "global" : "project";
  await openMemoryFile(scope, cwd);
}
