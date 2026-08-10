"use client";

import { usePathname,useRouter,useSearchParams } from "next/navigation";
import { useCallback,useState } from "react";

/**
 * Sync a nested sub-tab selection to the shared `subtab` URL search param so
 * admin sub-views (e.g. Slack's Configured / Onboard / Advanced) are
 * deep-linkable and survive refresh.
 *
 * Mirrors the OpenFGA tab convention: a single `subtab` param written with
 * `router.replace(..., { scroll: false })`. The admin page clears `subtab`
 * when switching top-level tabs, so each tab owns its own value space — pass
 * the values valid for THIS tab. An unknown/foreign value falls back to
 * `defaultValue`.
 *
 * Local state drives rendering so selecting a sub-tab updates the view
 * synchronously (no wait for the router round-trip); the URL is written as a
 * side effect. The other direction — deep links and browser back/forward — is
 * reconciled during render via a previous-value sentinel (the React-endorsed
 * "adjust state when a prop changes" pattern), avoiding a setState-in-effect.
 *
 * @param validValues  Sub-tab values valid for the current tab. Pass a stable
 *                      (module-level) reference.
 * @param defaultValue  Value used when the param is absent or unrecognized.
 */
export function useSubtabParam<T extends string>(
  validValues: readonly T[],
  defaultValue: T,
): [T, (next: T) => void] {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const raw = searchParams?.get("subtab") ?? null;
  const urlValue: T =
    raw && (validValues as readonly string[]).includes(raw) ? (raw as T) : defaultValue;

  const [active, setActive] = useState<T>(urlValue);
  const [prevUrlValue, setPrevUrlValue] = useState<T>(urlValue);
  if (urlValue !== prevUrlValue) {
    // The URL param changed out from under us (deep link / back-forward) —
    // adopt it. Clicks set `active` directly and update the URL afterward, so
    // by the time the URL catches up this branch is a no-op.
    setPrevUrlValue(urlValue);
    setActive(urlValue);
  }

  const setSubtab = useCallback(
    (next: T) => {
      setActive(next);
      const params = new URLSearchParams(searchParams?.toString() ?? "");
      params.set("subtab", next);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  return [active, setSubtab];
}
