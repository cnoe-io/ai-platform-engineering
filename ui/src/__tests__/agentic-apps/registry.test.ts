/**
 * @jest-environment node
 *
 * assisted-by Codex Codex-sonnet-4-6
 */

describe("agentic app registry", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    delete process.env.AGENTIC_APPS_INSTALL_ENABLED;
    delete process.env.AGENTIC_APPS_ENABLED;
    delete process.env.AGENTIC_APP_FINOPS_ORIGIN;
    delete process.env.AGENTIC_APP_FINOPS_MOUNT_PATH;
    delete process.env.AGENTIC_APP_FINOPS_DISABLED;
    delete process.env.AGENTIC_APP_WEATHER_ORIGIN;
    delete process.env.AGENTIC_APP_WEATHER_MOUNT_PATH;
    delete process.env.AGENTIC_APP_WEATHER_DISABLED;
    delete process.env.SHIP_LOOP_ENABLED;
    delete process.env.NEXT_PUBLIC_SHIP_LOOP_ENABLED;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("does not expose any app until the host install toggle is enabled", async () => {
    const { getEnabledAgenticApps } = await import("@/lib/agentic-apps/registry");

    expect(getEnabledAgenticApps()).toEqual([]);
  });

  it("loads FinOps from host configuration", async () => {
    process.env.AGENTIC_APPS_INSTALL_ENABLED = "true";
    process.env.AGENTIC_APPS_ENABLED = "finops";
    process.env.AGENTIC_APP_FINOPS_ORIGIN = "http://localhost:3010";

    const { getEnabledAgenticApps, getAgenticAppById } = await import(
      "@/lib/agentic-apps/registry"
    );

    expect(getEnabledAgenticApps()).toEqual([
      expect.objectContaining({
        id: "finops",
        displayName: "FinOps Dashboard",
        runtime: expect.objectContaining({
          kind: "proxied-next-zone",
          origin: "http://localhost:3010",
          mountPath: "/apps/finops",
        }),
        access: expect.objectContaining({
          tokenScopes: ["finops:read", "agents:invoke"],
        }),
      }),
    ]);
    expect(getAgenticAppById("finops")?.health.endpoint).toBe("/healthz");
  });

  it("loads the in-process Agentic SDLC app for the Apps Hub when SHIP_LOOP_ENABLED=true", async () => {
    process.env.AGENTIC_APPS_INSTALL_ENABLED = "true";
    process.env.AGENTIC_APPS_ENABLED = "agentic-sdlc";
    process.env.SHIP_LOOP_ENABLED = "true";

    const { getEnabledAgenticApps, getAgenticAppById } = await import(
      "@/lib/agentic-apps/registry"
    );

    expect(getEnabledAgenticApps()).toEqual([
      expect.objectContaining({
        id: "agentic-sdlc",
        displayName: "Agentic SDLC",
        runtime: expect.objectContaining({
          kind: "in-process",
          mountPath: "/apps/agentic-sdlc",
        }),
      }),
    ]);
    expect(getAgenticAppById("agentic-sdlc")?.surfaces.showInHub).toBe(true);
  });

  it("hides the Agentic SDLC app when SHIP_LOOP_ENABLED is unset, even if installed/enabled", async () => {
    process.env.AGENTIC_APPS_INSTALL_ENABLED = "true";
    process.env.AGENTIC_APPS_ENABLED = "agentic-sdlc";
    delete process.env.SHIP_LOOP_ENABLED;

    const { getEnabledAgenticApps, getAgenticAppById } = await import(
      "@/lib/agentic-apps/registry"
    );

    expect(getEnabledAgenticApps()).toEqual([]);
    expect(getAgenticAppById("agentic-sdlc")).toBeNull();
  });

  it("does not allow a host mount-path override outside /apps", async () => {
    process.env.AGENTIC_APPS_INSTALL_ENABLED = "true";
    process.env.AGENTIC_APPS_ENABLED = "finops";
    process.env.AGENTIC_APP_FINOPS_MOUNT_PATH = "/admin/finops";

    const { getAgenticAppById } = await import("@/lib/agentic-apps/registry");

    expect(getAgenticAppById("finops")?.runtime.mountPath).toBe("/apps/finops");
  });

  it("does not allow path traversal in host mount-path overrides", async () => {
    process.env.AGENTIC_APPS_INSTALL_ENABLED = "true";
    process.env.AGENTIC_APPS_ENABLED = "finops";
    process.env.AGENTIC_APP_FINOPS_MOUNT_PATH = "/apps/../admin";

    const { getAgenticAppById } = await import("@/lib/agentic-apps/registry");

    expect(getAgenticAppById("finops")?.runtime.mountPath).toBe("/apps/finops");
  });

  it("respects AGENTIC_APP_<ID>_ORIGIN override and trims trailing slashes", async () => {
    process.env.AGENTIC_APPS_INSTALL_ENABLED = "true";
    process.env.AGENTIC_APPS_ENABLED = "weather";
    process.env.AGENTIC_APP_WEATHER_ORIGIN = "http://weather.svc.cluster.local:3020/";

    const { getAgenticAppById } = await import("@/lib/agentic-apps/registry");

    expect(getAgenticAppById("weather")?.runtime.origin).toBe(
      "http://weather.svc.cluster.local:3020",
    );
  });

  it("force-disables an enabled app via AGENTIC_APP_<ID>_DISABLED=true", async () => {
    process.env.AGENTIC_APPS_INSTALL_ENABLED = "true";
    process.env.AGENTIC_APPS_ENABLED = "finops";
    process.env.AGENTIC_APP_FINOPS_DISABLED = "true";

    const { getEnabledAgenticApps, getAgenticAppById } = await import(
      "@/lib/agentic-apps/registry"
    );

    expect(getEnabledAgenticApps()).toEqual([]);
    expect(getAgenticAppById("finops")).toBeNull();
  });

  it("ignores AGENTIC_APP_<ID>_DISABLED when the value is not exactly 'true'", async () => {
    process.env.AGENTIC_APPS_INSTALL_ENABLED = "true";
    process.env.AGENTIC_APPS_ENABLED = "finops";
    process.env.AGENTIC_APP_FINOPS_DISABLED = "false";

    const { getAgenticAppById } = await import("@/lib/agentic-apps/registry");

    expect(getAgenticAppById("finops")).not.toBeNull();
  });
});
