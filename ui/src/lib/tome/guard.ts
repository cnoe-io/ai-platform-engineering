/**
 * Server-side feature gate for Tome.
 *
 * When `TOME_ENABLED !== "true"` (the default), the whole feature is off:
 * `/api/tome/**` routes return 404 and the `/apps/tome` tree calls notFound().
 * 404 (not 403/401) avoids leaking the feature's existence on hosts that have
 * it disabled — same contract as the Agentic SDLC gate.
 *
 * Deliberately does not import from `next/server` so it stays unit-testable.
 */

import { getServerConfig } from "@/lib/config";

/** For server components / layouts: follow up with `notFound()` when false. */
export function isTomeServerEnabled(): boolean {
  return getServerConfig().tomeEnabled;
}
