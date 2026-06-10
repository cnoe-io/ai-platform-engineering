// GET /api/projects/source-options?provider=github|atlassian
//
// Populates the onboarding wizard's source dropdowns from the signed-in user's
// own provider connection (Connections tab). Returns { connected, options }.
// When the user hasn't connected the provider, `connected:false` so the UI can
// prompt them to authorize. Best-effort — never throws on provider errors.
//
// assisted-by claude code claude-opus-4-8

import { NextRequest } from "next/server";

import {
  getAuthFromBearerOrSession,
  successResponse,
  withErrorHandler,
} from "@/lib/api-middleware";
import { getProviderConnectionService } from "@/lib/credentials/oauth-service-factory";

interface SourceOption {
  value: string;
  label: string;
}

async function githubRepos(token: string): Promise<SourceOption[]> {
  const res = await fetch(
    "https://api.github.com/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member",
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
  );
  if (!res.ok) return [];
  const repos = (await res.json().catch(() => [])) as Array<{
    full_name?: string;
    html_url?: string;
  }>;
  return repos
    .filter((r) => r.full_name && r.html_url)
    .map((r) => ({ value: r.html_url as string, label: r.full_name as string }));
}

async function atlassianSpaces(token: string): Promise<SourceOption[]> {
  const resourcesRes = await fetch(
    "https://api.atlassian.com/oauth/token/accessible-resources",
    { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } },
  );
  if (!resourcesRes.ok) return [];
  const resources = (await resourcesRes.json().catch(() => [])) as Array<{
    id?: string;
    url?: string;
  }>;
  const out: SourceOption[] = [];
  // Bound to the first few sites to keep the call fast.
  for (const site of resources.slice(0, 3)) {
    if (!site.id || !site.url) continue;
    const spacesRes = await fetch(
      `https://api.atlassian.com/ex/confluence/${site.id}/wiki/rest/api/space?limit=100`,
      { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } },
    );
    if (!spacesRes.ok) continue;
    const body = (await spacesRes.json().catch(() => ({}))) as {
      results?: Array<{ key?: string; name?: string }>;
    };
    for (const space of body.results ?? []) {
      if (!space.key) continue;
      out.push({
        value: `${site.url.replace(/\/$/, "")}/wiki/spaces/${space.key}`,
        label: `${space.name ?? space.key} (${space.key})`,
      });
    }
  }
  return out;
}

export const GET = withErrorHandler(async (request: NextRequest) => {
  const { session } = await getAuthFromBearerOrSession(request);
  const sub = (session as { sub?: string } | undefined)?.sub;
  const provider = new URL(request.url).searchParams.get("provider")?.trim() ?? "";

  if (!sub || (provider !== "github" && provider !== "atlassian")) {
    return successResponse({ connected: false, options: [] });
  }

  let token = "";
  try {
    const service = await getProviderConnectionService();
    const connection = (await service.listConnections({ type: "user", id: sub })).find(
      (c) => c.provider === provider && c.status === "connected",
    );
    if (!connection) {
      return successResponse({ connected: false, options: [] });
    }
    token = (await service.refreshConnection(connection.id)).accessToken;
  } catch {
    return successResponse({ connected: false, options: [] });
  }

  try {
    const options =
      provider === "github" ? await githubRepos(token) : await atlassianSpaces(token);
    return successResponse({ connected: true, options });
  } catch {
    return successResponse({ connected: true, options: [], error: "provider list failed" });
  }
});
