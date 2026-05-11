/**
 * @jest-environment node
 *
 * assisted-by Codex Codex-sonnet-4-6
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("FinOps dashboard cache route", () => {
  it("uses a Mongo-backed, user-scoped collection for last successful dashboard pulls", () => {
    const routeSource = readFileSync(
      join(process.cwd(), "src/app/api/agentic-apps/finops-cache/route.ts"),
      "utf8",
    );

    expect(routeSource).toContain("agentic_app_dashboard_cache");
    expect(routeSource).toContain("appId: \"finops\"");
    expect(routeSource).toContain("ownerId: user.email");
    expect(routeSource).toContain("replaceOne");
    expect(routeSource).toContain("payload");
    expect(routeSource).toContain("rawCost");
    expect(routeSource).toContain("trend");
    expect(routeSource).toContain("MAX_RUN_HISTORY");
    expect(routeSource).toContain("runs");
    expect(routeSource).toContain("items");
    expect(routeSource).toContain("runId");
  });
});
