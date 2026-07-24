"use client";

import { usePathname,useRouter,useSearchParams } from "next/navigation";
import { useCallback,useEffect,useRef } from "react";

export type UrlFilterParamUpdates = Record<string, string | null | undefined>;

/**
 * Replace selected URL search params without losing updates queued in the same
 * render. Keeping the pending query in a ref matters when one interaction
 * updates related filter groups before Next.js publishes new search params.
 */
export function useUrlFilterParams(): (updates: UrlFilterParamUpdates) => void {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const observedSearch = searchParams?.toString() ?? "";
  const pendingSearchRef = useRef(observedSearch);

  useEffect(() => {
    pendingSearchRef.current = observedSearch;
  }, [observedSearch]);

  return useCallback((updates: UrlFilterParamUpdates) => {
    const params = new URLSearchParams(pendingSearchRef.current);
    for (const [key, value] of Object.entries(updates)) {
      if (value === null || value === undefined) {
        params.delete(key);
      } else {
        params.set(key, value);
      }
    }

    const nextSearch = params.toString();
    pendingSearchRef.current = nextSearch;
    router.replace(nextSearch ? `${pathname}?${nextSearch}` : pathname, { scroll: false });
  }, [pathname, router]);
}
