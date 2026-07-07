"use client";

import { useEffect, useState } from "react";
import type { SourceKind } from "./index";

const VALID: SourceKind[] = ["github", "confluence", "webex"];

/**
 * The single "which connectors does this deployment use" answer, read by every
 * place that defines project sources (create wizard, project editing, ingest).
 *
 * Sources are strictly YAML-driven: the kinds are the ordered, de-duped `source`
 * values from the `provider: "source"` steps in the onboarding config
 * (`/api/projects/onboarding-config`). No steps → no source pickers anywhere.
 */
export function useProjectSourceKinds(): {
  kinds: SourceKind[];
  loading: boolean;
} {
  const [kinds, setKinds] = useState<SourceKind[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/projects/onboarding-config")
      .then((res) => res.json())
      .then((body) => {
        if (cancelled) return;
        const steps: Array<{ provider?: string; source?: string }> =
          body?.data?.config?.steps ?? [];
        const seen = new Set<string>();
        const out: SourceKind[] = [];
        for (const s of steps) {
          if (s.provider !== "source" || !s.source) continue;
          if (seen.has(s.source)) continue;
          if (!VALID.includes(s.source as SourceKind)) continue;
          seen.add(s.source);
          out.push(s.source as SourceKind);
        }
        setKinds(out);
      })
      .catch(() => {
        if (!cancelled) setKinds([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { kinds, loading };
}
