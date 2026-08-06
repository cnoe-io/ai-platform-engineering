// GET /api/projects/source-options?provider=github|atlassian
//
// Populates the onboarding wizard's source dropdowns from the signed-in user's
// own provider connection (Connections tab). Returns { connected, options }.
// When the user hasn't connected the provider, `connected:false` so the UI can
// prompt them to authorize. Best-effort - never throws on provider errors.

import { NextRequest } from "next/server";

import {
  getAuthFromBearerOrSession,
  successResponse,
  withErrorHandler,
} from "@/lib/api-middleware";
import { getProviderConnectionService } from "@/lib/credentials/oauth-service-factory";
import { getCredentialFeatureConfig } from "@/lib/feature-flags/credentials";
import type { GitHubRepositorySource } from "@/types/projects";

interface SourceOption {
  value: string;
  label: string;
  github_repo?: GitHubRepositorySource;
}

const GH_HEADERS = (token: string) => ({
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
});

interface GitHubRepositoryResponse {
  id?: number;
  node_id?: string;
  full_name?: string;
  html_url?: string;
  default_branch?: string;
}

function githubRepoOption(repo: GitHubRepositoryResponse): SourceOption | null {
  if (!repo.full_name || !repo.html_url) return null;
  const source: GitHubRepositorySource = {
    ...(typeof repo.id === "number" ? { id: repo.id } : {}),
    ...(repo.node_id ? { node_id: repo.node_id } : {}),
    full_name: repo.full_name,
    html_url: repo.html_url,
    ...(repo.default_branch ? { default_branch: repo.default_branch } : {}),
  };
  return { value: repo.html_url, label: repo.full_name, github_repo: source };
}

async function githubFetchRepos(token: string, url: string): Promise<SourceOption[]> {
  const res = await fetch(url, { headers: GH_HEADERS(token) });
  if (!res.ok) return [];
  const repos = (await res.json().catch(() => [])) as GitHubRepositoryResponse[];
  return repos
    .map(githubRepoOption)
    .filter((option): option is SourceOption => option !== null);
}

async function githubSearchRepos(token: string, cql: string): Promise<SourceOption[]> {
  // GitHub Search API searches repos the *authenticated user* can access -
  // public AND private (with the repo scope) - across the whole org, not just a
  // recency-capped first page. This is what makes name search actually find
  // private/older repos with the user's token.
  const res = await fetch(
    `https://api.github.com/search/repositories?per_page=50&q=${encodeURIComponent(cql)}`,
    { headers: GH_HEADERS(token) },
  );
  if (!res.ok) return [];
  const body = (await res.json().catch(() => ({}))) as {
    items?: GitHubRepositoryResponse[];
  };
  return (body.items ?? [])
    .map(githubRepoOption)
    .filter((option): option is SourceOption => option !== null);
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

// Personal spaces have keys beginning with `~` (followed by the owner's account
// id). They're per-user scratch areas, never a project's docs target, and on a
// large site they flood the picker. Excluded unless the caller searches for one.
function isPersonalSpaceKey(key: string): boolean {
  return key.startsWith("~");
}

// Initial browse should be useful and fast. Full-site coverage comes from the
// server-side search path once the user types; do not block first paint while
// walking thousands of spaces.
const SPACE_INITIAL_LIMIT = 50;

/** List one bounded page of spaces via the Confluence v2 spaces API.
 *
 * The v1 `/rest/api/space` endpoint is gone (HTTP 410), and CQL search caps at
 * a bounded result set. v2 is the supported browse API; CQL is merged below
 * for recently active, viewable-but-not-joined spaces. */
async function listSpacesV2(
  token: string,
  siteId: string,
  siteUrl: string,
  includePersonal: boolean,
  favoritedBy?: string,
): Promise<SourceOption[]> {
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };
  const gateway = `https://api.atlassian.com/ex/confluence/${siteId}`;
  const params = new URLSearchParams({ limit: String(SPACE_INITIAL_LIMIT) });
  if (favoritedBy) params.set("favorited-by", favoritedBy);
  const out: SourceOption[] = [];
  const res = await fetch(`${gateway}/wiki/api/v2/spaces?${params}`, { headers });
  if (!res.ok) return out;
  const body = (await res.json().catch(() => ({}))) as {
    results?: Array<{ key?: string; name?: string; type?: string }>;
  };
  for (const space of body.results ?? []) {
    if (!space.key) continue;
    if (
      !includePersonal &&
      (space.type === "personal" || isPersonalSpaceKey(space.key))
    ) {
      continue;
    }
    out.push(spaceOption(siteUrl, space.key, space.name));
  }
  return out;
}

/** List spaces for one Confluence site, ranked by explicit and behavioral
 * relevance: favorites, recently active spaces, then the v2 browse page. */
async function spacesForSite(
  token: string,
  siteId: string,
  siteUrl: string,
  includePersonal: boolean,
  accountId?: string,
): Promise<SourceOption[]> {
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };
  const base = `https://api.atlassian.com/ex/confluence/${siteId}/wiki`;
  const byKey = new Map<string, SourceOption>();
  const recent = new Map<string, SourceOption>();
  const [favorites, browse] = await Promise.all([
    accountId
      ? listSpacesV2(token, siteId, siteUrl, includePersonal, accountId)
      : Promise.resolve([]),
    listSpacesV2(token, siteId, siteUrl, includePersonal),
    runSpaceCql(
      base,
      headers,
      siteUrl,
      "type=space order by lastmodified desc",
      recent,
    ),
  ]);
  for (const option of [...favorites, ...recent.values(), ...browse]) {
    const key = option.value.split("/").pop() ?? option.value;
    if (!includePersonal && isPersonalSpaceKey(key)) continue;
    if (!byKey.has(key)) byKey.set(key, option);
  }
  return [...byKey.values()];
}

// Escape a user query for embedding in a CQL double-quoted string literal.
function cqlQuote(q: string): string {
  return q.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** Search a site's spaces by name OR key via CQL. Enumeration endpoints only
 * return spaces the user has *joined*; a viewable-but-not-joined space (e.g.
 * one shared org-wide) is only reachable by search. Matches title and key so
 * both the display name ("Collective Intelligence") and the key ("Cognitive")
 * find it. */
async function runSpaceCql(
  base: string,
  headers: Record<string, string>,
  siteUrl: string,
  cql: string,
  byKey: Map<string, SourceOption>,
): Promise<void> {
  const res = await fetch(
    `${base}/rest/api/search?cql=${encodeURIComponent(cql)}&limit=50`,
    { headers },
  );
  if (!res.ok) return;
  const body = (await res.json().catch(() => ({}))) as {
    results?: Array<{ title?: string; space?: { key?: string; name?: string } }>;
  };
  for (const r of body.results ?? []) {
    const key = r.space?.key;
    if (key && !byKey.has(key)) byKey.set(key, spaceOption(siteUrl, key, r.space?.name || r.title));
  }
}

async function searchSpacesByQuery(
  token: string,
  siteId: string,
  siteUrl: string,
  q: string,
): Promise<SourceOption[]> {
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };
  const base = `https://api.atlassian.com/ex/confluence/${siteId}/wiki`;
  const term = cqlQuote(q);
  const byKey = new Map<string, SourceOption>();
  // Two tolerant queries, unioned: `space.key~` (contains on key) is NOT valid
  // CQL and 400s the whole query, so we keep clauses separate and ignore any
  // that fail. Title-contains finds spaces by display name ("Collective
  // Intelligence"); exact-key finds them by key ("Cognitive").
  await Promise.all([
    runSpaceCql(
      base,
      headers,
      siteUrl,
      `type=space and title~"${term}*"`,
      byKey,
    ),
    runSpaceCql(
      base,
      headers,
      siteUrl,
      `type=space and space.key="${term}"`,
      byKey,
    ),
  ]);
  return [...byKey.values()];
}

async function atlassianSpaces(
  token: string,
  q: string,
): Promise<{ options: SourceOption[]; connectedTo: string }> {
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };
  const [resourcesRes, identityRes] = await Promise.all([
    fetch("https://api.atlassian.com/oauth/token/accessible-resources", {
      headers,
    }),
    fetch("https://api.atlassian.com/me", { headers }),
  ]);
  if (!resourcesRes.ok) return { options: [], connectedTo: "" };
  const resources = (await resourcesRes.json().catch(() => [])) as Array<{
    id?: string;
    url?: string;
  }>;
  const identity = identityRes.ok
    ? ((await identityRes.json().catch(() => ({}))) as { account_id?: string })
    : {};
  const query = q.trim();
  const byValue = new Map<string, SourceOption>();
  const uniqueSites = new Map<string, { id: string; url: string }>();
  for (const site of resources) {
    if (!site.id || !site.url) continue;
    let origin: string;
    try {
      origin = new URL(site.url).origin;
    } catch {
      continue;
    }
    const key = `${site.id}:${origin}`;
    if (!uniqueSites.has(key)) uniqueSites.set(key, { id: site.id, url: site.url });
  }
  const sites = [...uniqueSites.values()].slice(0, 3);
  const foundBySite = await Promise.all(
    sites.map((site) =>
      query
        ? searchSpacesByQuery(token, site.id, site.url, query)
        : spacesForSite(
            token,
            site.id,
            site.url,
            false,
            identity.account_id,
          ),
    ),
  );
  for (const found of foundBySite) {
    for (const o of found) if (!byValue.has(o.value)) byValue.set(o.value, o);
  }
  return {
    options: [...byValue.values()],
    connectedTo: (sites[0]?.url ?? "").replace(/^https?:\/\//, ""),
  };
}

async function webexRooms(token: string, q: string): Promise<SourceOption[]> {
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };
  const params = new URLSearchParams({ max: "100", sortBy: "lastactivity" });
  const res = await fetch(`https://webexapis.com/v1/rooms?${params}`, { headers });
  if (!res.ok) return [];
  const body = (await res.json().catch(() => ({}))) as {
    items?: Array<{ id?: string; title?: string }>;
  };
  const items = body.items ?? [];
  const options = items
    .filter((r) => r.id && r.title)
    .map((r) => ({ value: r.id as string, label: r.title as string }));
  if (!q.trim()) return options;
  const lower = q.toLowerCase();
  return options.filter((o) => o.label.toLowerCase().includes(lower));
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
    if (provider === "webex") {
      const r = await fetch("https://webexapis.com/v1/people/me", {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      });
      if (!r.ok) return "";
      const u = (await r.json().catch(() => ({}))) as { displayName?: string; emails?: string[] };
      return u.displayName || u.emails?.[0] || "";
    }
    return "";
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

  // Only point users at the Connections page when that feature is enabled in
  // this deployment - otherwise `/credentials` 404s, so the picker should just
  // offer manual entry. `manageUrl` is null when there's nowhere to link.
  const manageUrl = getCredentialFeatureConfig().enabled ? "/credentials" : null;

  if (!sub || (provider !== "github" && provider !== "atlassian" && provider !== "webex")) {
    return successResponse({ connected: false, options: [], manageUrl });
  }

  let token = "";
  try {
    const service = await getProviderConnectionService();
    const connection = (await service.listConnections({ type: "user", id: sub })).find(
      (c) => c.provider === provider && c.status === "connected",
    );
    if (!connection) {
      return successResponse({ connected: false, options: [], manageUrl });
    }
    token = (await service.refreshConnection(connection.id)).accessToken;
  } catch {
    return successResponse({ connected: false, options: [], manageUrl });
  }

  try {
    if (provider === "atlassian") {
      const result = await atlassianSpaces(token, q);
      return successResponse({
        connected: true,
        options: result.options,
        connectedTo: result.connectedTo,
        manageUrl,
      });
    }
    let optionsFn: (token: string, q: string) => Promise<SourceOption[]>;
    if (provider === "github") optionsFn = githubRepos;
    else optionsFn = webexRooms;

    const [options, account] = await Promise.all([
      optionsFn(token, q),
      connectedTo(provider, token),
    ]);
    return successResponse({ connected: true, options, connectedTo: account, manageUrl });
  } catch {
    return successResponse({ connected: true, options: [], error: "provider list failed", manageUrl });
  }
});
