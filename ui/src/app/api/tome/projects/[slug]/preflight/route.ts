// Preflight check: verify the authenticated user's OAuth tokens have actual
// resource-level access to each source attached to a project (not just "connected").
// POST → PreflightResult. Used by the IngestPanel and the tome_preflight_ingest MCP tool.

import { NextRequest } from "next/server";

import { successResponse, withErrorHandler } from "@/lib/api-middleware";
import { resolveForwardedCredentials } from "@/lib/tome/agent-proxy";
import { loadTomeProject } from "@/lib/tome/tome-api";
import type { PreflightResult, PreflightSourceResult } from "@/lib/tome/preflight";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string }> };

function normalizeRepoSlug(raw: string): string {
  let s = raw.trim().replace(/\.git$/, "");
  for (const prefix of ["https://github.com/", "github.com/"]) {
    if (s.startsWith(prefix)) s = s.slice(prefix.length);
  }
  return s;
}

async function checkGitHub(
  repos: string[],
  token: string,
): Promise<Omit<PreflightSourceResult, "label" | "provider">> {
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const results = await Promise.all(
    repos.map(async (raw) => {
      const slug = normalizeRepoSlug(raw);
      try {
        const r = await fetch(`https://api.github.com/repos/${slug}`, { headers });
        return { item: slug, ok: r.status === 200 };
      } catch {
        return { item: slug, ok: false };
      }
    }),
  );
  return {
    no_token: false,
    accessible: results.filter((r) => r.ok).map((r) => r.item),
    inaccessible: results.filter((r) => !r.ok).map((r) => r.item),
  };
}

async function checkConfluence(
  spaces: { space_key: string; base_url: string; name?: string }[],
  token: string,
  cloudId: string | undefined,
): Promise<Omit<PreflightSourceResult, "label" | "provider">> {
  // The classic /rest/api/space/{key} endpoint is gone (HTTP 410) on Atlassian
  // Cloud. Use a CQL search scoped to each space key instead — same approach as
  // the confluence MCP connector. Requires cloud_id from the credential entry.
  if (!cloudId) {
    return { no_token: false, accessible: [], inaccessible: spaces.map((s) => s.name || s.space_key) };
  }
  const apiBase = `https://api.atlassian.com/ex/confluence/${cloudId}/wiki/rest/api`;
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };

  const results = await Promise.all(
    spaces.map(async (s) => {
      const label = s.name || s.space_key;
      try {
        const cql = `type=space AND space.key="${s.space_key.replace(/"/g, '\\"')}"`;
        const url = `${apiBase}/search?${new URLSearchParams({ cql, limit: "1" }).toString()}`;
        const r = await fetch(url, { headers });
        if (!r.ok) return { item: label, ok: false };
        const json = (await r.json()) as { results?: unknown[] };
        return { item: label, ok: (json.results?.length ?? 0) > 0 };
      } catch {
        return { item: label, ok: false };
      }
    }),
  );
  return {
    no_token: false,
    accessible: results.filter((r) => r.ok).map((r) => r.item),
    inaccessible: results.filter((r) => !r.ok).map((r) => r.item),
  };
}

async function checkWebex(
  rooms: { room_id: string; name?: string }[],
  token: string,
): Promise<Omit<PreflightSourceResult, "label" | "provider">> {
  const results = await Promise.all(
    rooms.map(async (room) => {
      const label = room.name || room.room_id;
      try {
        const r = await fetch(`https://webexapis.com/v1/rooms/${encodeURIComponent(room.room_id)}`, {
          headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        });
        return { item: label, ok: r.status === 200 };
      } catch {
        return { item: label, ok: false };
      }
    }),
  );
  return {
    no_token: false,
    accessible: results.filter((r) => r.ok).map((r) => r.item),
    inaccessible: results.filter((r) => !r.ok).map((r) => r.item),
  };
}

export const POST = withErrorHandler(async (request: NextRequest, ctx: Ctx) => {
  const { slug } = await ctx.params;
  const tctx = await loadTomeProject(request, slug);
  const creds = await resolveForwardedCredentials(tctx);

  const project = tctx.project;
  const sources = project.sources ?? {};
  const results: PreflightSourceResult[] = [];

  const repos: string[] = Array.isArray(sources.repos)
    ? sources.repos.filter(Boolean)
    : [];
  type CFSpace = { space_key: string; base_url: string; name?: string };

  // Parse the old flat confluence_url format: https://{site}.atlassian.net/wiki/spaces/{key}
  function parseConfluenceUrl(url: string): CFSpace | null {
    const m = url.match(/^(https?:\/\/[^/]+)(\/wiki\/spaces\/([^/?#]+))/);
    if (!m) return null;
    return { base_url: m[1], space_key: m[3] };
  }

  const confluenceSpaces: CFSpace[] = (
    Array.isArray(sources.confluence_spaces) && sources.confluence_spaces.length > 0
      ? sources.confluence_spaces
          .filter((s) => s.space_key && s.base_url)
          .map((s) => ({ space_key: s.space_key as string, base_url: s.base_url as string, name: ("name" in s ? s.name : undefined) as string | undefined }))
      : sources.confluence_url
        ? [parseConfluenceUrl(sources.confluence_url as string)].filter(Boolean) as CFSpace[]
        : []
  );
  const webexRooms: { room_id: string; name?: string }[] = Array.isArray(sources.webex_rooms)
    ? sources.webex_rooms
    : [];

  const [ghResult, cfResult, wxResult] = await Promise.all([
    repos.length > 0
      ? creds["github"]?.access_token
        ? checkGitHub(repos, creds["github"].access_token)
        : Promise.resolve({ no_token: true, accessible: [], inaccessible: repos.map(normalizeRepoSlug) })
      : null,
    confluenceSpaces.length > 0
      ? creds["atlassian"]?.access_token
        ? checkConfluence(confluenceSpaces, creds["atlassian"].access_token, creds["atlassian"]?.cloud_id)
        : Promise.resolve({ no_token: true, accessible: [], inaccessible: confluenceSpaces.map((s) => s.name || s.space_key) })
      : null,
    webexRooms.length > 0
      ? creds["webex"]?.access_token
        ? checkWebex(webexRooms, creds["webex"].access_token)
        : Promise.resolve({ no_token: true, accessible: [], inaccessible: webexRooms.map((r) => r.name || r.room_id) })
      : null,
  ]);

  if (ghResult) results.push({ provider: "github", label: "GitHub", ...ghResult });
  if (cfResult) results.push({ provider: "confluence", label: "Confluence", ...cfResult });
  if (wxResult) results.push({ provider: "webex", label: "Webex", ...wxResult });

  const can_ingest =
    results.length === 0 ||
    results.every((r) => !r.no_token && r.inaccessible.length === 0);

  const origin =
    process.env.NEXTAUTH_URL ||
    (request.headers.get("x-forwarded-proto") ?? "https") +
      "://" +
      (request.headers.get("host") ?? "localhost");

  return successResponse({
    can_ingest,
    sources: results,
    credentials_url: `${origin}/credentials`,
  } satisfies PreflightResult);
});
