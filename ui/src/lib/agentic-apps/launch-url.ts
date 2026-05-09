// assisted-by Codex Codex-sonnet-4-6

import type { AgenticAppManifest } from "@/types/agentic-app";

/**
 * Resolve the user-facing URL for launching an Agentic App.
 *
 * Apps that opt into `runtime.chrome === "iframe"` are rendered inside the
 * standard CAIPE shell at `/apps/embed/<id>`. The shell page wraps the
 * upstream mountPath in an `<iframe>` so users see the CAIPE header above the
 * app.
 *
 * Apps with `runtime.chrome === "fullscreen"` (default) launch directly at
 * `physicalHref ?? mountPath` — the upstream owns the entire viewport. This
 * is the safe default for apps that ship their own header/nav (and matches
 * the FinOps and Weather samples).
 *
 * @param manifest    The app's manifest.
 * @param physicalHref Optional physical mount path (e.g. installation override
 *                    via `runtimeMountPath`). Used only for fullscreen apps;
 *                    iframe-chrome apps always launch through the shell page,
 *                    which itself reads the override at render time.
 */
export function resolveAgenticAppLaunchUrl(
  manifest: AgenticAppManifest,
  physicalHref?: string,
): string {
  if (manifest.runtime.chrome === "iframe") {
    return `/apps/embed/${manifest.id}`;
  }
  return physicalHref || manifest.runtime.mountPath;
}
