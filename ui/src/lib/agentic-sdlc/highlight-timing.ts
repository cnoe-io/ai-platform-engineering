import type { CSSProperties } from "react";

export const REPO_UPDATE_HIGHLIGHT_MS = 30_000;
export const TRON_HALO_COLOR = "#00f5ff";

export const REPO_UPDATE_HIGHLIGHT_CLASS =
  "relative overflow-visible ring-2 ring-[var(--repo-update-halo)] bg-cyan-400/10 shadow-[0_0_18px_var(--repo-update-halo),0_0_48px_var(--repo-update-halo),0_0_90px_rgba(0,245,255,0.28)] before:pointer-events-none before:absolute before:-inset-1 before:rounded-[inherit] before:border before:border-[var(--repo-update-halo)] before:shadow-[0_0_28px_var(--repo-update-halo)] before:content-[''] motion-safe:animate-pulse";

export function repoUpdateHighlightStyle(
  haloColor: string,
  revealIndex = 0,
): CSSProperties {
  return {
    "--repo-update-halo": haloColor,
    animationDelay: `${Math.min(revealIndex, 12) * 120}ms`,
    animationFillMode: "both",
  } as CSSProperties;
}
