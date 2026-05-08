/**
 * Pins per-user defaults for the Agentic SDLC companion feature flags.
 *
 * The parent `shipLoop` per-user flag was retired when Agentic SDLC moved
 * to the Agentic Apps platform — visibility is now driven by
 * `SHIP_LOOP_ENABLED` (server env) plus the standard Agentic Apps
 * install/enabled gates and RBAC. The assistant + simulation flags remain
 * per-user toggles.
 */

import { FEATURE_FLAGS } from "@/store/feature-flag-store";

describe("Agentic SDLC feature-flag defaults", () => {
  it("does not register a per-user `shipLoop` visibility flag (retired)", () => {
    const flag = FEATURE_FLAGS.find((f) => f.id === "shipLoop");
    expect(flag).toBeUndefined();
  });

  it("defaults the assistant sub-feature to ON once the server enables it", () => {
    const flag = FEATURE_FLAGS.find((f) => f.id === "shipLoopAssistant");
    expect(flag).toBeDefined();
    expect(flag!.defaultValue).toBe(true);
    expect(flag!.preferencesKey).toBe("ship_loop_assistant_enabled");
  });

  it("defaults simulation mode to OFF so real repo pages do not show mock controls", () => {
    const flag = FEATURE_FLAGS.find((f) => f.id === "shipLoopSimulation");
    expect(flag).toBeDefined();
    expect(flag!.defaultValue).toBe(false);
    expect(flag!.preferencesKey).toBe("ship_loop_simulation_enabled");
  });

  it("uses Agentic SDLC copy on the assistant flag", () => {
    const assistant = FEATURE_FLAGS.find((f) => f.id === "shipLoopAssistant");
    expect(assistant!.label).toBe("Agentic SDLC Assistant");
    expect(assistant!.detail).not.toMatch(/Agentic SDLC view/i);
  });
});
