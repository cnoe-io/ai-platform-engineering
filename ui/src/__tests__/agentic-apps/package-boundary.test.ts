/**
 * @jest-environment node
 *
 * assisted-by Codex Codex-sonnet-4-6
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

describe("agentic app package boundaries", () => {
  it("keeps SDK and UI kit free of CAIPE host aliases", () => {
    const files = listFiles(join(process.cwd(), "src/packages"));
    const offenders = files.filter((file) => readFileSync(file, "utf8").includes('from "@/'));

    expect(offenders).toEqual([]);
  });

  it("keeps reference apps free of CAIPE host source imports", () => {
    const files = listFiles(join(process.cwd(), "apps"));
    const offenders = files.filter((file) => /from\s+["']@\/|require\(["']@\//.test(readFileSync(file, "utf8")));

    expect(offenders).toEqual([]);
  });
});

function listFiles(root: string): string[] {
  return readdirSync(root).flatMap((entry) => {
    const path = join(root, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      return listFiles(path);
    }
    return /\.(mjs|js|jsx|ts|tsx)$/.test(path) ? [path] : [];
  });
}
