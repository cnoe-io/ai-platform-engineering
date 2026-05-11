/**
 * @jest-environment node
 *
 * assisted-by Codex Codex-sonnet-4-6
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("Weather dashboard cache route", () => {
  it("uses a Mongo-backed, user-scoped collection for last successful weather dashboard pulls", () => {
    const routeSource = readFileSync(
      join(process.cwd(), "src/app/api/agentic-apps/weather-cache/route.ts"),
      "utf8",
    );

    expect(routeSource).toContain("agentic_app_dashboard_cache");
    expect(routeSource).toContain("appId: \"weather\"");
    expect(routeSource).toContain("ownerId: user.email");
    expect(routeSource).toContain("replaceOne");
    expect(routeSource).toContain("payload");
    expect(routeSource).toContain("weather.dashboard.v1");
    expect(routeSource).toContain("city");
    expect(routeSource).toContain("intent");
    expect(routeSource).toContain("MAX_RUN_HISTORY");
    expect(routeSource).toContain("runs");
    expect(routeSource).toContain("items");
    expect(routeSource).toContain("runId");
  });
});
