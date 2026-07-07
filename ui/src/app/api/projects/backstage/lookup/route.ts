// assisted-by claude code claude-sonnet-4-6
// Backstage system lookup for the onboarding wizard's "import from catalog" step.
import { NextRequest } from "next/server";

import { getAuthFromBearerOrSession, successResponse, withErrorHandler } from "@/lib/api-middleware";
import { isBackstageConfigured, fetchBackstageSystems } from "@/lib/projects/backstage-client";

export const GET = withErrorHandler(async (request: NextRequest) => {
  await getAuthFromBearerOrSession(request);

  const configured = isBackstageConfigured();
  if (!configured) {
    return successResponse({ configured: false, results: [] });
  }

  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() ?? "";

  try {
    const systems = await fetchBackstageSystems();
    const filtered = q
      ? systems.filter(
          (s) =>
            s.slug.toLowerCase().includes(q.toLowerCase()) ||
            s.title.toLowerCase().includes(q.toLowerCase()),
        )
      : systems;

    const results = filtered.map((s) => {
      const annotations = s.catalog?.metadata?.annotations ?? {};
      const githubSlug =
        annotations["github.com/project-slug"] ??
        annotations["backstage.io/source-location"]?.replace(/^url:/, "") ??
        "";
      const repos = githubSlug
        ? [`https://github.com/${githubSlug}`]
        : [];
      return {
        slug: s.slug,
        title: s.title,
        description: s.description,
        tags: s.tags ?? [],
        repos,
      };
    });

    return successResponse({ configured: true, results });
  } catch {
    return successResponse({ configured: true, results: [] });
  }
});
