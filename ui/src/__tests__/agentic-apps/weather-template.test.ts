/**
 * @jest-environment node
 *
 * assisted-by Codex Codex-sonnet-4-6
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { BUILTIN_AGENTIC_APP_PACKAGE_SEEDS } from "@/lib/agentic-apps/builtin-packages";

describe("weather starter app template", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  it("ships Weather as a built-in AG-UI-first package seed", () => {
    const weather = BUILTIN_AGENTIC_APP_PACKAGE_SEEDS.find(
      (pkg) => pkg.packageId === "weather",
    );

    expect(weather).toEqual(
      expect.objectContaining({
        packageId: "weather",
        source: "builtin",
        catalog: expect.objectContaining({
          categories: expect.arrayContaining(["starter", "weather"]),
          capabilities: expect.arrayContaining(["ag-ui-layout", "copilotkit-action"]),
        }),
      }),
    );
    expect(weather?.manifest).toEqual(
      expect.objectContaining({
        id: "weather",
        displayName: "Weather Starter",
        runtime: expect.objectContaining({
          kind: "proxied-next-zone",
          mountPath: "/apps/weather",
        }),
        access: expect.objectContaining({
          tokenScopes: expect.arrayContaining(["weather:read", "agents:invoke"]),
          canUseCustomAgents: true,
        }),
      }),
    );
  });

  it("supports Weather in the local env registry for quick host demos", async () => {
    process.env.AGENTIC_APPS_INSTALL_ENABLED = "true";
    process.env.AGENTIC_APPS_ENABLED = "weather";
    process.env.AGENTIC_APP_WEATHER_ORIGIN = "http://localhost:3020";

    const { getAgenticAppById } = await import("@/lib/agentic-apps/registry");

    expect(getAgenticAppById("weather")).toEqual(
      expect.objectContaining({
        id: "weather",
        runtime: expect.objectContaining({
          origin: "http://localhost:3020",
          mountPath: "/apps/weather",
        }),
      }),
    );
  });

  it("provides a standalone CopilotKit and AG-UI oriented weather runtime script", () => {
    const packageJson = JSON.parse(
      readFileSync(join(process.cwd(), "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };
    const serverSource = readFileSync(
      join(process.cwd(), "apps/weather-starter/server.mjs"),
      "utf8",
    );

    expect(packageJson.scripts["agentic-apps:weather"]).toBe(
      "node apps/weather-starter/server.mjs",
    );
    expect(serverSource).toContain("url.pathname === \"/embed\"");
    expect(serverSource).toContain("weather-fragment");
    expect(serverSource).toContain("/api/ag-ui/weather-layout");
    expect(serverSource).toContain("/api/copilotkit/weather-agent");
    expect(serverSource).toContain("useCopilotAction");
  });
});
