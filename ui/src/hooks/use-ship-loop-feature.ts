"use client";

/**
 * Two-layer gating hook for the Agentic SDLC Ship Loop feature.
 *
 * Both layers must be on for `enabled` to be true:
 *   1. Server-side env: `Config.shipLoopEnabled` (SHIP_LOOP_ENABLED=true)
 *   2. Per-user feature flag: `shipLoop` in feature-flag-store, default
 *      `true` so the feature shows up automatically once the operator
 *      turns the server-side flag on. Users who explicitly opt out via
 *      the Settings panel write `false` to localStorage + server
 *      preferences and that choice is preserved on subsequent visits.
 *
 * The assistant side panel (`shipLoopAssistantEnabled` + per-user
 * `shipLoopAssistant`) is gated independently, defaults to `false`
 * until the panel itself ships, AND is implicitly disabled when the
 * parent flag is off.
 *
 * Spec: docs/docs/specs/2026-05-05-agentic-sdlc-ship-loop-ui/spec.md
 */

import { useFeatureFlagStore } from "@/store/feature-flag-store";
import { config } from "@/lib/config";

export type ShipLoopDisabledReason =
  | null
  | "server-disabled"
  | "user-flag-off";

export interface UseShipLoopFeatureResult {
  /** True iff both server config AND per-user flag are on. */
  enabled: boolean;
  /**
   * True iff `enabled` is true AND the assistant sub-feature is also on
   * at both layers.
   */
  assistantEnabled: boolean;
  /** Why the feature is disabled (null when enabled). */
  disabledReason: ShipLoopDisabledReason;
}

export function useShipLoopFeature(): UseShipLoopFeatureResult {
  const userShipLoop = useFeatureFlagStore((s) =>
    s.flags.shipLoop ?? false,
  );
  const userAssistant = useFeatureFlagStore((s) =>
    s.flags.shipLoopAssistant ?? false,
  );

  const serverEnabled = config.shipLoopEnabled;
  const serverAssistantEnabled = config.shipLoopAssistantEnabled;

  const enabled = serverEnabled && userShipLoop;
  const assistantEnabled =
    enabled && serverAssistantEnabled && userAssistant;

  const disabledReason: ShipLoopDisabledReason = !serverEnabled
    ? "server-disabled"
    : !userShipLoop
      ? "user-flag-off"
      : null;

  return { enabled, assistantEnabled, disabledReason };
}
