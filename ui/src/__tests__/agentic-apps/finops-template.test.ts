/**
 * @jest-environment node
 *
 * assisted-by Codex Codex-sonnet-4-6
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("finops sample app template", () => {
  it("provides an integrated runtime contract with API and fragment endpoints", () => {
    const packageJson = JSON.parse(
      readFileSync(join(process.cwd(), "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };
    const serverSource = readFileSync(
      join(process.cwd(), "apps/finops-dashboard/server.mjs"),
      "utf8",
    );

    expect(packageJson.scripts["agentic-apps:finops"]).toBe(
      "node apps/finops-dashboard/server.mjs",
    );
    expect(serverSource).toContain("url.pathname === \"/embed\"");
    expect(serverSource).toContain("finops-fragment");
    expect(serverSource).toContain("/api/summary");
  });
});
