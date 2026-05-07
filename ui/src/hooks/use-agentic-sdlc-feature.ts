"use client";

/**
 * Two-layer gating hook for the Agentic SDLC feature.
 *
 * Both layers must be on for `enabled` to be true:
 *   1. Server-side env: `Config.shipLoopEnabled` (SHIP_LOOP_ENABLED=true)
 *   2. Per-user feature flag: `shipLoop` in feature-flag-store, default
 *      `true` so the feature shows up automatically once the operator
 *      turns the server-side flag on. Users who explicitly opt out via
 *      the Settings panel write `false` to localStorage + server
 *      preferences and that choice is preserved on subsequent visits.
 *
 * The assistant bubble is controlled by the server env
 * (`shipLoopAssistantEnabled`) once the parent feature is visible.
 *
 * Spec: docs/docs/specs/2026-05-05-agentic-sdlc-ship-loop-ui/spec.md
 */

import { useFeatureFlagStore } from "@/store/feature-flag-store";
import { config } from "@/lib/config";

export type AgenticSdlcDisabledReason =
  | null
  | "server-disabled"
  | "user-flag-off";

export interface UseAgenticSdlcFeatureResult {
  /** True iff both server config AND per-user flag are on. */
  enabled: boolean;
  /**
   * True iff `enabled` is true AND the assistant sub-feature is also on
   * at both layers.
   */
  assistantEnabled: boolean;
  /** Why the feature is disabled (null when enabled). */
  disabledReason: AgenticSdlcDisabledReason;
}

export function useAgenticSdlcFeature(): UseAgenticSdlcFeatureResult {
  const userAgenticSdlc = useFeatureFlagStore((s) =>
    s.flags.shipLoop ?? false,
  );
  const serverEnabled = config.shipLoopEnabled;
  const serverAssistantEnabled = config.shipLoopAssistantEnabled;

  const enabled = serverEnabled && userAgenticSdlc;
  const assistantEnabled = enabled && serverAssistantEnabled;

  const disabledReason: AgenticSdlcDisabledReason = !serverEnabled
    ? "server-disabled"
    : !userAgenticSdlc
      ? "user-flag-off"
      : null;

  return { enabled, assistantEnabled, disabledReason };
}
