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

const GH_HEADERS = (token: string) => ({
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
});

async function githubFetchRepos(token: string, url: string): Promise<SourceOption[]> {
  const res = await fetch(url, { headers: GH_HEADERS(token) });
  if (!res.ok) return [];
  const repos = (await res.json().catch(() => [])) as Array<{
    full_name?: string;
    html_url?: string;
  }>;
  return repos
    .filter((r) => r.full_name && r.html_url)
    .map((r) => ({ value: r.html_url as string, label: r.full_name as string }));
}

async function githubSearchRepos(token: string, cql: string): Promise<SourceOption[]> {
  // GitHub Search API searches repos the *authenticated user* can access —
  // public AND private (with the repo scope) — across the whole org, not just a
  // recency-capped first page. This is what makes name search actually find
  // private/older repos with the user's token.
  const res = await fetch(
    `https://api.github.com/search/repositories?per_page=50&q=${encodeURIComponent(cql)}`,
    { headers: GH_HEADERS(token) },
  );
  if (!res.ok) return [];
  const body = (await res.json().catch(() => ({}))) as {
    items?: Array<{ full_name?: string; html_url?: string }>;
  };
  return (body.items ?? [])
    .filter((r) => r.full_name && r.html_url)
    .map((r) => ({ value: r.html_url as string, label: r.full_name as string }));
}

// Repo lookup is ORG-SCOPED (not a global GitHub search) and always uses the
// caller's token, so private repos they can access are included:
//   - "" (nothing typed)        → the caller's own repos (/user/repos)
//   - "cisco-eti"               → browse that org's repos (first page by recency)
//   - "cisco-eti/act"           → SEARCH the org for repos named *act* (token-
//                                 scoped Search API → full coverage incl. private)
async function githubRepos(token: string, q: string): Promise<SourceOption[]> {
  const path = q.replace(/^https?:\/\/github\.com\//i, "").trim();
  const [owner, ...rest] = path.split("/");
  const namePart = rest.join("/").trim();

  if (!owner) {
    return githubFetchRepos(
      token,
      "https://api.github.com/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member",
    );
  }

  // A name fragment was typed (e.g. "cisco-eti/act") → search the org by name
  // with the user's token (covers private + repos beyond the first page).
  if (namePart) {
    const hits = await githubSearchRepos(token, `org:${owner} ${namePart} in:name fork:true`);
    if (hits.length > 0) return hits;
    return githubSearchRepos(token, `user:${owner} ${namePart} in:name fork:true`);
  }

  // Just the org typed → browse its repos. Prefer /orgs/{org}/repos (includes
  // private when the token is a member); fall back to /users/{owner}/repos for
  // personal accounts (the orgs endpoint 404s on a user).
  const enc = encodeURIComponent(owner);
  const orgRepos = await githubFetchRepos(
    token,
    `https://api.github.com/orgs/${enc}/repos?per_page=100&sort=updated&type=all`,
  );
  if (orgRepos.length > 0) return orgRepos;
  return githubFetchRepos(
    token,
    `https://api.github.com/users/${enc}/repos?per_page=100&sort=updated&type=all`,
  );
}

function spaceOption(siteUrl: string, key: string, name?: string): SourceOption {
  return {
    value: `${siteUrl.replace(/\/$/, "")}/wiki/spaces/${key}`,
    label: `${name || key} (${key})`,
  };
}

/** List spaces for one Confluence site, trying three methods (de-duped by key)
 * so we work under whatever scopes the connection was actually granted:
 *   1. CQL search type=space          — needs search:confluence
 *   2. GET /wiki/rest/api/space        — needs read:confluence-space.summary
 *   3. derive from content + expand=space — works under read:confluence-content.all
 * Method 3 is the safety net: most existing connections only have content.all,
 * so without it the picker would silently return nothing. */
async function spacesForSite(token: string, siteId: string, siteUrl: string): Promise<SourceOption[]> {
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };
  const base = `https://api.atlassian.com/ex/confluence/${siteId}/wiki`;
  const byKey = new Map<string, SourceOption>();

  // Method 1: CQL search for spaces.
  const searchRes = await fetch(
    `${base}/rest/api/search?cql=${encodeURIComponent("type=space")}&limit=100`,
    { headers },
  );
  if (searchRes.ok) {
    const sbody = (await searchRes.json().catch(() => ({}))) as {
      results?: Array<{ title?: string; space?: { key?: string; name?: string } }>;
    };
    for (const r of sbody.results ?? []) {
      const key = r.space?.key;
      if (key) byKey.set(key, spaceOption(siteUrl, key, r.space?.name || r.title));
    }
  }

  // Method 2: the spaces REST endpoint.
  const spacesRes = await fetch(`${base}/rest/api/space?limit=100`, { headers });
  if (spacesRes.ok) {
    const body = (await spacesRes.json().catch(() => ({}))) as {
      results?: Array<{ key?: string; name?: string }>;
    };
    for (const s of body.results ?? []) {
      if (s.key && !byKey.has(s.key)) byKey.set(s.key, spaceOption(siteUrl, s.key, s.name));
    }
  }

  // Method 3 (safety net): derive distinct spaces from accessible content. Only
  // needs read:confluence-content.all, which existing connections already hold.
  if (byKey.size === 0) {
    const contentRes = await fetch(
      `${base}/rest/api/content?limit=200&expand=space`,
      { headers },
    );
    if (contentRes.ok) {
      const body = (await contentRes.json().catch(() => ({}))) as {
        results?: Array<{ space?: { key?: string; name?: string } }>;
      };
      for (const r of body.results ?? []) {
        const key = r.space?.key;
        if (key && !byKey.has(key)) byKey.set(key, spaceOption(siteUrl, key, r.space?.name));
      }
    }
  }

  return [...byKey.values()];
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
