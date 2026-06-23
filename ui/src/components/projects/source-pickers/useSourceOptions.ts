"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface SourceOption {
  value: string;
  label: string;
}

export interface SourceOptionsState {
  connected: boolean;
  connectedTo?: string;
  options: SourceOption[];
  loading: boolean;
  /** Connections page URL when that feature is enabled here, else null. */
  manageUrl: string | null;
}

type Loaded = Omit<SourceOptionsState, "loading">;

/** Pure fetch — no React state — so callers control when state updates. */
async function loadSourceOptions(
  provider: "github" | "atlassian" | "webex",
  q?: string,
): Promise<Loaded> {
  const url = `/api/projects/source-options?provider=${provider}${
    q ? `&q=${encodeURIComponent(q)}` : ""
  }`;
  const res = await fetch(url);
  const json = await res.json();
  const d = json?.data ?? {};
  return {
    connected: Boolean(d.connected),
    connectedTo: typeof d.connectedTo === "string" ? d.connectedTo : undefined,
    options: Array.isArray(d.options) ? d.options : [],
    manageUrl: typeof d.manageUrl === "string" ? d.manageUrl : null,
  };
}

/**
 * Live-fetch a connected provider's resources from `/api/projects/source-options`
 * (the same endpoint the Connections tab feeds) + a debounced `search`. This is
 * the data behind the "connect → see your actual repos/spaces → pick" pickers.
 */
export function useSourceOptions(
  provider: "github" | "atlassian" | "webex",
): SourceOptionsState & { search: (q: string) => void; reload: () => void } {
  const [state, setState] = useState<SourceOptionsState>({
    connected: false,
    options: [],
    loading: true,
    manageUrl: null,
  });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Initial load: setState only inside the promise callback (not the effect body).
  useEffect(() => {
    let cancelled = false;
    loadSourceOptions(provider)
      .then((d) => !cancelled && setState({ ...d, loading: false }))
      .catch(() => !cancelled && setState((s) => ({ ...s, loading: false })));
    return () => {
      cancelled = true;
    };
  }, [provider]);

  // Event-handler refetch (allowed to setState directly).
  const run = useCallback(
    (q?: string) => {
      setState((s) => ({ ...s, loading: true }));
      loadSourceOptions(provider, q)
        .then((d) => setState({ ...d, loading: false }))
        .catch(() => setState((s) => ({ ...s, loading: false })));
    },
    [provider],
  );

  const search = useCallback(
    (q: string) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => run(q.trim() || undefined), 300);
    },
    [run],
  );

  const reload = useCallback(() => run(), [run]);

  return { ...state, search, reload };
}
