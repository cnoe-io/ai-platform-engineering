/**
 * Pins the per-user default for the Agentic SDLC feature flag.
 *
 * Policy: when SHIP_LOOP_ENABLED=true on the server, every user should
 * see the feature without having to opt in. We model that by defaulting
 * the per-user `shipLoop` flag to `true` in the feature-flag store.
 * Users who explicitly opt out via the Settings panel write `false` to
 * localStorage + server preferences, and that explicit choice is
 * honored by readFromLocalStorage on subsequent visits.
 *
 * The companion sub-feature (`shipLoopAssistant`) now defaults on in
 * preferences; the server env remains the source of truth.
 */

import { FEATURE_FLAGS } from "@/store/feature-flag-store";

describe("Agentic SDLC feature-flag defaults", () => {
  it("defaults the parent shipLoop flag to ON so the server toggle controls visibility", () => {
    const flag = FEATURE_FLAGS.find((f) => f.id === "shipLoop");
    expect(flag).toBeDefined();
    expect(flag!.defaultValue).toBe(true);
  });

  it("defaults the assistant sub-feature to ON once the server enables it", () => {
    const flag = FEATURE_FLAGS.find((f) => f.id === "shipLoopAssistant");
    expect(flag).toBeDefined();
    expect(flag!.defaultValue).toBe(true);
  });

  it("defaults simulation mode to OFF so real repo pages do not show mock controls", () => {
    const flag = FEATURE_FLAGS.find((f) => f.id === "shipLoopSimulation");
    expect(flag).toBeDefined();
    expect(flag!.defaultValue).toBe(false);
    expect(flag!.preferencesKey).toBe("ship_loop_simulation_enabled");
  });

  it("preserves the existing preferences keys so server-side prefs round-trip", () => {
    const parent = FEATURE_FLAGS.find((f) => f.id === "shipLoop");
    const assistant = FEATURE_FLAGS.find((f) => f.id === "shipLoopAssistant");
    const simulation = FEATURE_FLAGS.find((f) => f.id === "shipLoopSimulation");
    expect(parent!.preferencesKey).toBe("ship_loop_enabled");
    expect(assistant!.preferencesKey).toBe("ship_loop_assistant_enabled");
    expect(simulation!.preferencesKey).toBe("ship_loop_simulation_enabled");
  });

  it("uses Agentic SDLC as the user-facing feature name", () => {
    const parent = FEATURE_FLAGS.find((f) => f.id === "shipLoop");
    const assistant = FEATURE_FLAGS.find((f) => f.id === "shipLoopAssistant");
    expect(parent!.label).toBe("Agentic SDLC");
    expect(parent!.description).toBe(
      "Live dashboard for agent-driven Epic/PR/deploy flow",
    );
    expect(parent!.detail).toBe(
      "Onboard a GitHub repo and watch agents take an Epic through sub-tasks, PRs, HITL reviews, and sandbox deploys in real time. Requires SHIP_LOOP_ENABLED=true on the server.",
    );
    expect(assistant!.label).toBe("Agentic SDLC Assistant");
    expect(assistant!.detail).not.toMatch(/Agentic SDLC view/i);
  });
});
