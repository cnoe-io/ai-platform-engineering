/**
 * Verify that the two Ship Loop config knobs round-trip cleanly through
 * the server-side config builder. These are the *server-side* half of the
 * two-layer toggle (env var + per-user feature flag).
 */

import { getServerConfig } from "@/lib/config";

describe("Ship Loop config keys", () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("defaults shipLoopEnabled and shipLoopAssistantEnabled to false", () => {
    delete process.env.SHIP_LOOP_ENABLED;
    delete process.env.SHIP_LOOP_ASSISTANT_ENABLED;
    const cfg = getServerConfig();
    expect(cfg.shipLoopEnabled).toBe(false);
    expect(cfg.shipLoopAssistantEnabled).toBe(false);
  });

  it("reads SHIP_LOOP_ENABLED=true", () => {
    process.env.SHIP_LOOP_ENABLED = "true";
    expect(getServerConfig().shipLoopEnabled).toBe(true);
  });

  it("treats SHIP_LOOP_ENABLED=anything-else as false (deny by default)", () => {
    process.env.SHIP_LOOP_ENABLED = "1";
    expect(getServerConfig().shipLoopEnabled).toBe(false);
    process.env.SHIP_LOOP_ENABLED = "yes";
    expect(getServerConfig().shipLoopEnabled).toBe(false);
    process.env.SHIP_LOOP_ENABLED = "";
    expect(getServerConfig().shipLoopEnabled).toBe(false);
  });

  it("reads SHIP_LOOP_ASSISTANT_ENABLED=true independent of the parent flag", () => {
    delete process.env.SHIP_LOOP_ENABLED;
    process.env.SHIP_LOOP_ASSISTANT_ENABLED = "true";
    const cfg = getServerConfig();
    // The two flags are independent at the config layer; the parent gate
    // (`shipLoopEnabled`) is enforced by `useShipLoopFeature` and
    // `withShipLoopGate`, not by mutating the assistant flag here.
    expect(cfg.shipLoopEnabled).toBe(false);
    expect(cfg.shipLoopAssistantEnabled).toBe(true);
  });
});
