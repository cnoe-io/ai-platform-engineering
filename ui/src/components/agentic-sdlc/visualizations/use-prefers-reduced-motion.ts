"use client";

/**
 * Tiny hook around `(prefers-reduced-motion: reduce)`. Used by the
 * Agentic SDLC visualizations so they can omit imperative animations
 * entirely (e.g. SVG `<animateMotion>`, which CSS `motion-safe:`
 * cannot gate) instead of merely declining to start them.
 *
 * Returns `false` during SSR and on the very first client render to
 * avoid a hydration mismatch — the static fallback is a strict subset
 * of the animated tree, so a one-frame "animation may run" until the
 * effect resolves is acceptable.
 */

import { useEffect, useState } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia(QUERY);
    const handle = () => setReduced(mql.matches);
    handle();
    if (mql.addEventListener) {
      mql.addEventListener("change", handle);
      return () => mql.removeEventListener("change", handle);
    }
    // Safari < 14 fallback.
    mql.addListener(handle);
    return () => mql.removeListener(handle);
  }, []);

  return reduced;
}
