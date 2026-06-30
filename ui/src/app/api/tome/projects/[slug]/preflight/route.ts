// Preflight check: verify the authenticated user's OAuth tokens have actual
// resource-level access to each source attached to a project (not just "connected").
// POST → PreflightResult. Used by the IngestPanel and the tome_preflight_ingest MCP tool.

import { NextRequest } from "next/server";

import { successResponse, withErrorHandler } from "@/lib/api-middleware";
import { resolveForwardedCredentials } from "@/lib/tome/agent-proxy";
import { loadTomeProject } from "@/lib/tome/tome-api";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string }> };

export interface PreflightSourceResult {
  provider: "github" | "confluence" | "webex";
  label: string;
  /** Items that passed the resource-level access check. */
  accessible: string[];
  /** Items where the check returned 403/404 (no access or not found). */
  inaccessible: string[];
  /** True when the provider token is missing entirely (not just per-item failures). */
  no_token: boolean;
}

export interface PreflightResult {
  can_ingest: boolean;
  sources: PreflightSourceResult[];
  credentials_url: string;
}

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
): Promise<Omit<PreflightSourceResult, "label" | "provider">> {
  const results = await Promise.all(
    spaces.map(async (s) => {
      const label = s.name || s.space_key;
      try {
        const base = s.base_url.replace(/\/$/, "");
        const r = await fetch(`${base}/wiki/rest/api/space/${encodeURIComponent(s.space_key)}`, {
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
  const confluenceSpaces: CFSpace[] = (
    Array.isArray(sources.confluence_spaces)
      ? sources.confluence_spaces
      : sources.confluence_url
        ? [{ space_key: sources.confluence_url as string, base_url: sources.confluence_url as string }]
        : []
  )
    .filter((s) => s.space_key && s.base_url)
    .map((s) => ({ space_key: s.space_key as string, base_url: s.base_url as string, name: ("name" in s ? s.name : undefined) as string | undefined }));
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
        ? checkConfluence(confluenceSpaces, creds["atlassian"].access_token)
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
