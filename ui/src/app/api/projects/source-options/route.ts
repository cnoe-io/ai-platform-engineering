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

// Personal spaces have keys beginning with `~` (followed by the owner's account
// id). They're per-user scratch areas, never a project's docs target, and on a
// large site they flood the picker. Excluded unless the caller searches for one.
function isPersonalSpaceKey(key: string): boolean {
  return key.startsWith("~");
}

// v2 returns up to 250 spaces per page; we follow its cursor across pages.
const SPACE_PAGE_LIMIT = 250;
const SPACE_MAX_PAGES = 20; // up to 5000 spaces

/** Enumerate all spaces for a site via the Confluence v2 spaces API.
 *
 * The v1 `/rest/api/space` endpoint is gone (HTTP 410), and CQL search caps at
 * ~100 results with no real pagination - so spaces past the first page (e.g.
 * `Cognitive`) were invisible. v2 paginates properly via `_links.next` cursors
 * and returns every space type (global, collaboration, knowledge_base, …),
 * which CQL relevance ranking did not. */
async function listSpacesV2(
  token: string,
  siteId: string,
  siteUrl: string,
  includePersonal: boolean,
): Promise<SourceOption[]> {
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };
  const gateway = `https://api.atlassian.com/ex/confluence/${siteId}`;
  const out: SourceOption[] = [];
  let path: string | null = `/wiki/api/v2/spaces?limit=${SPACE_PAGE_LIMIT}`;

  for (let page = 0; page < SPACE_MAX_PAGES && path; page++) {
    const res: Response = await fetch(`${gateway}${path}`, { headers });
    if (!res.ok) break;
    const body = (await res.json().catch(() => ({}))) as {
      results?: Array<{ key?: string; name?: string; type?: string }>;
      _links?: { next?: string };
    };
    for (const s of body.results ?? []) {
      if (!s.key) continue;
      if (!includePersonal && (s.type === "personal" || isPersonalSpaceKey(s.key))) continue;
      out.push(spaceOption(siteUrl, s.key, s.name));
    }
    // `_links.next` is a relative path (e.g. /wiki/api/v2/spaces?cursor=…).
    path = body._links?.next ?? null;
  }
  return out;
}

/** List spaces for one Confluence site (v2 API, cursor-paginated), with a
 * CQL-search fallback for connections whose scopes don't permit v2 reads.
 * Personal spaces are excluded unless the caller is searching for one. */
async function spacesForSite(
  token: string,
  siteId: string,
  siteUrl: string,
  includePersonal: boolean,
): Promise<SourceOption[]> {
  const v2 = await listSpacesV2(token, siteId, siteUrl, includePersonal);
  if (v2.length > 0) return v2;

  // Fallback: paginated CQL search (works under search:confluence).
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };
  const base = `https://api.atlassian.com/ex/confluence/${siteId}/wiki`;
  const byKey = new Map<string, SourceOption>();
  for (let start = 0; start < 1000; start += 100) {
    const res = await fetch(
      `${base}/rest/api/search?cql=${encodeURIComponent("type=space")}&limit=100&start=${start}`,
      { headers },
    );
    if (!res.ok) break;
    const body = (await res.json().catch(() => ({}))) as {
      results?: Array<{ title?: string; space?: { key?: string; name?: string } }>;
    };
    const results = body.results ?? [];
    for (const r of results) {
      const key = r.space?.key;
      if (key && !byKey.has(key)) byKey.set(key, spaceOption(siteUrl, key, r.space?.name || r.title));
    }
    if (results.length < 100) break;
  }
  const all = [...byKey.values()];
  if (includePersonal) return all;
  return all.filter((o) => !isPersonalSpaceKey(o.value.split("/").pop() ?? ""));
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
  await runSpaceCql(base, headers, siteUrl, `type=space and title~"${term}*"`, byKey);
  await runSpaceCql(base, headers, siteUrl, `type=space and space.key="${term}"`, byKey);
  return [...byKey.values()];
}

async function atlassianSpaces(token: string, q: string): Promise<SourceOption[]> {
  const resourcesRes = await fetch(
    "https://api.atlassian.com/oauth/token/accessible-resources",
    { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } },
  );
  if (!resourcesRes.ok) return [];
  const resources = (await resourcesRes.json().catch(() => [])) as Array<{
    id?: string;
    url?: string;
  }>;
  const query = q.trim();
  const byValue = new Map<string, SourceOption>();
  // Bound to the first few sites to keep the call fast. A cloud often exposes
  // the same Confluence site as multiple accessible-resources (e.g. one per
  // product), so dedupe by value to avoid listing a space twice.
  for (const site of resources.slice(0, 3)) {
    if (!site.id || !site.url) continue;
    // With a query, search (finds viewable-but-not-joined spaces); without one,
    // enumerate the user's spaces as the default browse list.
    const found = query
      ? await searchSpacesByQuery(token, site.id, site.url, query)
      : await spacesForSite(token, site.id, site.url, false);
    for (const o of found) if (!byValue.has(o.value)) byValue.set(o.value, o);
  }
  return [...byValue.values()];
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
    let optionsFn: (token: string, q: string) => Promise<SourceOption[]>;
    if (provider === "github") optionsFn = githubRepos;
    else if (provider === "atlassian") optionsFn = atlassianSpaces;
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
