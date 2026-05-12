import type { CSSProperties } from "react";

export const REPO_UPDATE_HIGHLIGHT_MS = 30_000;
export const TRON_HALO_COLOR = "#00f5ff";

export const REPO_UPDATE_HIGHLIGHT_CLASS =
  "relative overflow-visible ring-1 ring-[var(--repo-update-halo)]/60 bg-cyan-400/5 shadow-[0_0_10px_rgba(0,245,255,0.22),0_0_24px_rgba(0,245,255,0.12)] before:pointer-events-none before:absolute before:-inset-0.5 before:rounded-[inherit] before:border before:border-[var(--repo-update-halo)]/35 before:shadow-[0_0_12px_rgba(0,245,255,0.16)] before:content-['']";

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
