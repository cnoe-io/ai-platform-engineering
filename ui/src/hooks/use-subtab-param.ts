"use client";

import { usePathname,useRouter,useSearchParams } from "next/navigation";
import { useCallback,useState } from "react";

/**
 * Sync a tab selection to a URL search param (default `subtab`) so tabbed
 * views (e.g. Slack's Configured / Onboard / Advanced, or a page's own
 * top-level tabs) are deep-linkable and survive refresh.
 *
 * Mirrors the OpenFGA tab convention: a single param written with
 * `router.replace(..., { scroll: false })`. When nesting (a top-level `tab`
 * param plus a `subtab` param scoped to it), the outer tab should clear
 * `subtab` when switching, so each tab owns its own value space — pass the
 * values valid for THIS tab. An unknown/foreign value falls back to
 * `defaultValue`.
 *
 * Local state drives rendering so selecting a tab updates the view
 * synchronously (no wait for the router round-trip); the URL is written as a
 * side effect. The other direction — deep links and browser back/forward — is
 * reconciled during render via a previous-value sentinel (the React-endorsed
 * "adjust state when a prop changes" pattern), avoiding a setState-in-effect.
 *
 * @param validValues  Tab values valid for the current scope. Pass a stable
 *                      (module-level) reference.
 * @param defaultValue  Value used when the param is absent or unrecognized.
 * @param paramName  URL search param to sync to. Defaults to `"subtab"`; pass
 *                    `"tab"` for a page's top-level tabs.
 */
export function useSubtabParam<T extends string>(
  validValues: readonly T[],
  defaultValue: T,
  paramName: string = "subtab",
): [T, (next: T) => void] {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const raw = searchParams?.get(paramName) ?? null;
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
      params.set(paramName, next);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [pathname, router, searchParams, paramName],
  );

  return [active, setSubtab];
}
