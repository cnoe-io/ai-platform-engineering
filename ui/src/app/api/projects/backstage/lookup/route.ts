// GET /api/projects/backstage/lookup?q=
//
// Lightweight, read-only lookup of Backstage Systems for the onboarding wizard's
// "Look up from Backstage" button. Returns just enough to pre-fill the create
// form (title / description / tags / repo links). Unlike the admin discover/sync
// endpoints this is open to any authenticated user — it only reads the catalog
// and never writes. Best-effort: returns an empty list when Backstage isn't
// configured or is unreachable.
//
// assisted-by claude code claude-opus-4-8

import { NextRequest } from "next/server";

import {
  getAuthFromBearerOrSession,
  successResponse,
  withErrorHandler,
} from "@/lib/api-middleware";
import {
  fetchBackstageSystems,
  isBackstageConfigured,
} from "@/lib/projects/backstage-client";

interface BackstageLookupResult {
  slug: string;
  title: string;
  description: string;
  tags: string[];
  repos: string[];
}

// Backstage records the repo on the `backstage.io/source-location` annotation as
// e.g. `url:https://github.com/org/repo`. Normalize it to a plain https URL.
function repoFromAnnotations(annotations: Record<string, string> | undefined): string | null {
  const raw =
    annotations?.["backstage.io/source-location"] ||
    annotations?.["backstage.io/managed-by-location"] ||
    "";
  const cleaned = raw.replace(/^url:/, "").replace(/\/[^/]*$/, (m) =>
    // keep ".../tree/main" style paths but strip a trailing catalog-info.yaml ref
    /catalog-info\.ya?ml$/i.test(m) ? "" : m,
  );
  const match = cleaned.match(/https?:\/\/[^\s]+/);
  return match ? match[0].replace(/\/$/, "") : null;
}

export const GET = withErrorHandler(async (request: NextRequest) => {
  await getAuthFromBearerOrSession(request);

  if (!isBackstageConfigured()) {
    return successResponse({ configured: false, results: [] });
  }

  const q = (new URL(request.url).searchParams.get("q") ?? "").trim().toLowerCase();

  let systems: Awaited<ReturnType<typeof fetchBackstageSystems>> = [];
  try {
    systems = await fetchBackstageSystems();
  } catch {
    return successResponse({ configured: true, results: [] });
  }

  const results: BackstageLookupResult[] = systems
    .map((s) => {
      const repo = repoFromAnnotations(s.catalog?.metadata?.annotations);
      return {
        slug: s.slug,
        title: s.title,
        description: s.description,
        tags: s.tags ?? [],
        repos: repo ? [repo] : [],
      };
    })
    .filter((r) =>
      q
        ? `${r.slug} ${r.title} ${r.description} ${r.tags.join(" ")}`
            .toLowerCase()
            .includes(q)
        : true,
    )
    .slice(0, 50);

  return successResponse({ configured: true, results });
});

export const dynamic = "force-dynamic";
