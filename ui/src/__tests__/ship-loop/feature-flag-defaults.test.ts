/**
 * Pins the per-user default for the Ship Loop feature flag.
 *
 * Policy: when SHIP_LOOP_ENABLED=true on the server, every user should
 * see the feature without having to opt in. We model that by defaulting
 * the per-user `shipLoop` flag to `true` in the feature-flag store.
 * Users who explicitly opt out via the Settings panel write `false` to
 * localStorage + server preferences, and that explicit choice is
 * honored by readFromLocalStorage on subsequent visits.
 *
 * The companion sub-feature (`shipLoopAssistant`) stays opt-in until
 * the AG-UI assistant panel actually ships (US5 / T071-T083).
 */

import { FEATURE_FLAGS } from "@/store/feature-flag-store";

describe("Ship Loop feature-flag defaults", () => {
  it("defaults the parent shipLoop flag to ON so the server toggle controls visibility", () => {
    const flag = FEATURE_FLAGS.find((f) => f.id === "shipLoop");
    expect(flag).toBeDefined();
    expect(flag!.defaultValue).toBe(true);
  });

  it("keeps the assistant sub-feature opt-in by default until the panel ships", () => {
    const flag = FEATURE_FLAGS.find((f) => f.id === "shipLoopAssistant");
    expect(flag).toBeDefined();
    expect(flag!.defaultValue).toBe(false);
  });

  it("preserves the existing preferences keys so server-side prefs round-trip", () => {
    const parent = FEATURE_FLAGS.find((f) => f.id === "shipLoop");
    const assistant = FEATURE_FLAGS.find((f) => f.id === "shipLoopAssistant");
    expect(parent!.preferencesKey).toBe("ship_loop_enabled");
    expect(assistant!.preferencesKey).toBe("ship_loop_assistant_enabled");
  });
});
