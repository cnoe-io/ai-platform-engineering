"use client";

import { useEffect, useLayoutEffect, useRef, type DependencyList, type RefObject } from "react";

/**
 * Tracks whether a scrollable viewport is within `thresholdPx` of its
 * bottom edge, via a live scroll listener. Returns a ref (not state) so
 * reading it never triggers a re-render; callers read `.current` at the
 * moment new content arrives to decide whether to auto-scroll.
 *
 * Starts `true` (most surfaces open already pinned to the newest content).
 */
export function useStickToBottom(
  viewportRef: RefObject<HTMLElement | null>,
  thresholdPx = 80,
): RefObject<boolean> {
  const stickToBottomRef = useRef(true);

  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const onScroll = () => {
      stickToBottomRef.current = vp.scrollHeight - vp.scrollTop - vp.clientHeight < thresholdPx;
    };
    vp.addEventListener("scroll", onScroll, { passive: true });
    return () => vp.removeEventListener("scroll", onScroll);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return stickToBottomRef;
}

/**
 * Auto-scrolls a viewport to the bottom when `deps` change (new content),
 * but only if the user was already near the bottom - so scrolling up to
 * read earlier output doesn't get yanked back down by the next update.
 *
 * For simple append-only views (a chat transcript, a growing log). Views
 * that also prepend older content above the current scroll position (e.g.
 * reverse-infinite-scroll pagination) need to restore the anchor offset
 * themselves; that's list-specific and out of scope for this hook.
 */
export function useAutoScroll(
  viewportRef: RefObject<HTMLElement | null>,
  deps: DependencyList,
  thresholdPx = 80,
): void {
  const stickToBottomRef = useStickToBottom(viewportRef, thresholdPx);

  useLayoutEffect(() => {
    const vp = viewportRef.current;
    if (vp && stickToBottomRef.current) {
      vp.scrollTop = vp.scrollHeight;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
