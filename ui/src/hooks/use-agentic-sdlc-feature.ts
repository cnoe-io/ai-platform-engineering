"use client";

// assisted-by Codex Codex-sonnet-4-6

/**
 * Server-config gate for the Agentic SDLC feature.
 *
 * Visibility used to be a two-layer gate (server env + per-user flag).
 * Agentic SDLC is now an Agentic App, so install/enabled state is owned
 * by the Agentic Apps registry + RBAC. This hook only reflects the
 * server env layer (`SHIP_LOOP_ENABLED`) plus the assistant sub-feature
 * (`SHIP_LOOP_ASSISTANT_ENABLED`).
 *
 * Spec: docs/docs/specs/2026-05-05-agentic-sdlc-ship-loop-ui/spec.md
 */

import { config } from "@/lib/config";

export type AgenticSdlcDisabledReason = null | "server-disabled";

export interface UseAgenticSdlcFeatureResult {
  /** True iff the server-side env flag is on. */
  enabled: boolean;
  /**
   * True iff `enabled` AND the assistant sub-feature env flag is on.
   */
  assistantEnabled: boolean;
  /** Why the feature is disabled (null when enabled). */
  disabledReason: AgenticSdlcDisabledReason;
}

export function useAgenticSdlcFeature(): UseAgenticSdlcFeatureResult {
  const serverEnabled = config.shipLoopEnabled;
  const serverAssistantEnabled = config.shipLoopAssistantEnabled;

  const enabled = serverEnabled;
  const assistantEnabled = enabled && serverAssistantEnabled;
  const disabledReason: AgenticSdlcDisabledReason = !serverEnabled
    ? "server-disabled"
    : null;

  return { enabled, assistantEnabled, disabledReason };
}
