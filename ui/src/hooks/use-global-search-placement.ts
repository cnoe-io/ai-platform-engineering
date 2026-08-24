"use client";

import { config } from "@/lib/config";
import {
  normalizeGlobalSearchPlacement,
  type GlobalSearchPlacement,
} from "@/lib/global-search-placement";
import React from "react";

const GLOBAL_SEARCH_PLACEMENT_CHANGED_EVENT =
  "caipe:global-search-placement-changed";

export function publishGlobalSearchPlacement(
  placement: GlobalSearchPlacement,
): void {
  window.dispatchEvent(new CustomEvent(GLOBAL_SEARCH_PLACEMENT_CHANGED_EVENT, {
    detail: placement,
  }));
}

export function useGlobalSearchPlacement(): GlobalSearchPlacement {
  const [placement,setPlacement] = React.useState<GlobalSearchPlacement>(
    config.globalSearchPlacement,
  );

  React.useEffect(() => {
    let cancelled = false;
    const handleChange = (event: Event) => {
      const next = normalizeGlobalSearchPlacement(
        (event as CustomEvent<unknown>).detail,
      );
      if (next) setPlacement(next);
    };

    window.addEventListener(
      GLOBAL_SEARCH_PLACEMENT_CHANGED_EVENT,
      handleChange,
    );

    if (typeof fetch === "function") {
      void fetch("/api/admin/platform-config", {
        credentials: "same-origin",
      })
        .then(async (response) => response.ok ? response.json() : null)
        .then((payload: unknown) => {
          if (cancelled || !payload || typeof payload !== "object") return;
          const data = (payload as { data?: unknown }).data;
          if (!data || typeof data !== "object") return;
          const next = normalizeGlobalSearchPlacement(
            (data as { global_search_placement?: unknown })
              .global_search_placement,
          );
          if (next) setPlacement(next);
        })
        .catch(() => undefined);
    }

    return () => {
      cancelled = true;
      window.removeEventListener(
        GLOBAL_SEARCH_PLACEMENT_CHANGED_EVENT,
        handleChange,
      );
    };
  }, []);

  return placement;
}
