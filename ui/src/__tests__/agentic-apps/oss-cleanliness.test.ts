/**
 * @jest-environment node
 *
 * assisted-by Codex Codex-sonnet-4-6
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

describe("agentic app OSS cleanliness", () => {
  it("keeps reference apps free of private app names and CAIPE host imports", () => {
    const files = listFiles(join(process.cwd(), "apps"));
    const forbiddenNamePattern = new RegExp(["outshift", "internal"].join("-") + "|" + ["private", "app"].join("-"), "i");
    const offenders = files.filter((file) => {
      const text = readFileSync(file, "utf8");
      return forbiddenNamePattern.test(text) || /from\s+["']@\/|require\(["']@\//i.test(text);
    });

    expect(offenders).toEqual([]);
  });
});

function listFiles(root: string): string[] {
  return readdirSync(root).flatMap((entry) => {
    const path = join(root, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) return listFiles(path);
    return /\.(mjs|js|jsx|ts|tsx|md)$/.test(path) ? [path] : [];
  });
}
