/**
 * @jest-environment node
 *
 * assisted-by Codex Codex-sonnet-4-6
 */

import type { AgenticAppManifest } from "@/types/agentic-app";

jest.mock("@/lib/agentic-apps/store", () => ({
  appendHealthSnapshot: jest.fn(),
  appendAgenticAppEvent: jest.fn(),
}));

const manifest: AgenticAppManifest = {
  id: "weather",
  displayName: "Weather",
  description: "Forecasts",
  apiVersion: "1.0",
  runtime: { kind: "proxied-next-zone", mountPath: "/apps/weather", origin: "http://localhost:3020" },
  surfaces: { showInHub: true },
  access: { tokenScopes: ["weather:read"] },
  health: { endpoint: "/healthz", blockLaunchWhen: ["degraded", "unreachable"] },
};

describe("agentic app health", () => {
  it("records healthy, degraded, and unreachable health snapshots", async () => {
    const { checkAgenticAppHealth } = await import("@/lib/agentic-apps/health");
    const pkg = { packageId: "weather", source: "builtin" as const, manifest };
    const installation = { appId: "weather", packageId: "weather", installed: true, enabled: true };

    await expect(
      checkAgenticAppHealth({
        pkg,
        installation,
        fetcher: jest.fn().mockResolvedValue(new Response("ok", { status: 200 })) as unknown as typeof fetch,
      }),
    ).resolves.toEqual(expect.objectContaining({ status: "healthy" }));

    await expect(
      checkAgenticAppHealth({
        pkg,
        installation,
        fetcher: jest.fn().mockResolvedValue(new Response("bad request", { status: 400 })) as unknown as typeof fetch,
      }),
    ).resolves.toEqual(expect.objectContaining({ status: "degraded", reasonCode: "http_400" }));

    await expect(
      checkAgenticAppHealth({
        pkg,
        installation,
        fetcher: jest.fn().mockRejectedValue(new Error("down")) as unknown as typeof fetch,
      }),
    ).resolves.toEqual(expect.objectContaining({ status: "unreachable", reasonCode: "fetch_failed" }));
  });

  it("maps blocked health states to user-safe reasons", async () => {
    const { getUserSafeHealthBlockedReason } = await import("@/lib/agentic-apps/health");

    expect(getUserSafeHealthBlockedReason({ status: "degraded", blockLaunchWhen: ["degraded"] })).toBe(
      "runtime_degraded",
    );
    expect(getUserSafeHealthBlockedReason({ status: "unreachable", blockLaunchWhen: ["unreachable"] })).toBe(
      "runtime_unavailable",
    );
    expect(getUserSafeHealthBlockedReason({ status: "healthy", blockLaunchWhen: ["degraded"] })).toBeNull();
  });
});
