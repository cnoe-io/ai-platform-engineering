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

async function githubRepos(token: string, q: string): Promise<SourceOption[]> {
  // When the user has typed an owner/org (e.g. "my-org" or
  // "https://github.com/my-org/…"), list that org/user's repos; otherwise list
  // the caller's own repos across owner/collaborator/org-member affiliations.
  const owner = q
    .replace(/^https?:\/\/github\.com\//i, "")
    .split("/")[0]
    .trim();
  const url = owner
    ? `https://api.github.com/users/${encodeURIComponent(owner)}/repos?per_page=100&sort=updated&type=all`
    : "https://api.github.com/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member";
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!res.ok) return [];
  const repos = (await res.json().catch(() => [])) as Array<{
    full_name?: string;
    html_url?: string;
  }>;
  return repos
    .filter((r) => r.full_name && r.html_url)
    .map((r) => ({ value: r.html_url as string, label: r.full_name as string }));
}

function spaceOption(siteUrl: string, key: string, name?: string): SourceOption {
  return {
    value: `${siteUrl.replace(/\/$/, "")}/wiki/spaces/${key}`,
    label: `${name || key} (${key})`,
  };
}

/** List spaces for one Confluence site. Primary: GET /wiki/rest/api/space
 * (needs read:confluence-space.summary). Fallback: CQL search type=space
 * (needs search:confluence) so it still works if the space scope is missing. */
async function spacesForSite(token: string, siteId: string, siteUrl: string): Promise<SourceOption[]> {
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };
  const base = `https://api.atlassian.com/ex/confluence/${siteId}/wiki`;

  const spacesRes = await fetch(`${base}/rest/api/space?limit=100`, { headers });
  if (spacesRes.ok) {
    const body = (await spacesRes.json().catch(() => ({}))) as {
      results?: Array<{ key?: string; name?: string }>;
    };
    const out = (body.results ?? [])
      .filter((s) => s.key)
      .map((s) => spaceOption(siteUrl, s.key as string, s.name));
    if (out.length) return out;
  }

  // Fallback: CQL search for spaces (works under search:confluence).
  const searchRes = await fetch(
    `${base}/rest/api/search?cql=${encodeURIComponent("type=space")}&limit=100`,
    { headers },
  );
  if (!searchRes.ok) return [];
  const sbody = (await searchRes.json().catch(() => ({}))) as {
    results?: Array<{ title?: string; space?: { key?: string; name?: string } }>;
  };
  const out: SourceOption[] = [];
  for (const r of sbody.results ?? []) {
    const key = r.space?.key;
    if (!key) continue;
    out.push(spaceOption(siteUrl, key, r.space?.name || r.title));
  }
  return out;
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
    out.push(...(await spacesForSite(token, site.id, site.url)));
  }
  return out;
}

/** Human label of the account/site the token is connected to (for the UI). */
async function connectedTo(provider: string, token: string): Promise<string> {
  try {
    if (provider === "github") {
      const r = await fetch("https://api.github.com/user", {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
      });
      if (!r.ok) return "";
      const u = (await r.json().catch(() => ({}))) as { login?: string };
      return u.login ? `github.com/${u.login}` : "";
    }
    // atlassian: first accessible Confluence site URL (e.g. cisco-eti.atlassian.net)
    const r = await fetch("https://api.atlassian.com/oauth/token/accessible-resources", {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    if (!r.ok) return "";
    const sites = (await r.json().catch(() => [])) as Array<{ url?: string }>;
    return (sites[0]?.url ?? "").replace(/^https?:\/\//, "");
  } catch {
    return "";
  }
}

export const GET = withErrorHandler(async (request: NextRequest) => {
  const { session } = await getAuthFromBearerOrSession(request);
  const sub = (session as { sub?: string } | undefined)?.sub;
  const sp = new URL(request.url).searchParams;
  const provider = sp.get("provider")?.trim() ?? "";
  const q = sp.get("q")?.trim() ?? "";

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
    const [options, account] = await Promise.all([
      provider === "github" ? githubRepos(token, q) : atlassianSpaces(token),
      connectedTo(provider, token),
    ]);
    return successResponse({ connected: true, options, connectedTo: account });
  } catch {
    return successResponse({ connected: true, options: [], error: "provider list failed" });
  }
});
