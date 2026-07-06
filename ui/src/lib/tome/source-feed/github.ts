// GitHub source-activity fetcher. Given a repo + token + a since-cursor,
// returns curated, normalized SourceEvents (PRs, issues, releases). Direct REST
// calls mirror the pattern already used in the Tome preflight route; no new
// dependency. Deliberately curated, not a firehose: bot actors are dropped and
// the result is capped per poll.

import type { EventProvenance, SourceEvent } from "./types";

const GH_API = "https://api.github.com";

/** Parse a repo string (URL or `owner/name`) into its parts. */
export function parseOwnerRepo(repo: string): { owner: string; name: string } | null {
  const cleaned = repo
    .trim()
    .replace(/\.git$/, "")
    .replace(/^https?:\/\/github\.com\//i, "")
    .replace(/^\/+|\/+$/g, "");
  const parts = cleaned.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  return { owner: parts[0], name: parts[1] };
}

/** True for bot/automation actors we exclude from the feed (dependabot, etc.). */
function isBotActor(login: string | null | undefined): boolean {
  if (!login) return false;
  const l = login.toLowerCase();
  return l.endsWith("[bot]") || l === "dependabot" || l.endsWith("-bot");
}

async function ghGet(
  path: string,
  token: string,
  params: Record<string, string | number> = {},
): Promise<unknown> {
  const qs = new URLSearchParams(
    Object.entries(params).map(([k, v]) => [k, String(v)]),
  ).toString();
  const res = await fetch(`${GH_API}${path}${qs ? `?${qs}` : ""}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`GitHub ${path} failed (${res.status}): ${detail.slice(0, 200)}`);
  }
  return res.json();
}

function prov(type: EventProvenance["type"], ref: string, url: string): EventProvenance[] {
  return [{ type, ref, url }];
}

interface GhPull {
  number: number;
  title: string;
  html_url: string;
  state: string;
  created_at: string;
  closed_at: string | null;
  merged_at: string | null;
  user?: { login?: string } | null;
}

interface GhIssue {
  number: number;
  title: string;
  html_url: string;
  created_at: string;
  closed_at: string | null;
  user?: { login?: string } | null;
  pull_request?: unknown; // present when the "issue" is actually a PR
}

interface GhRelease {
  tag_name: string;
  name: string | null;
  html_url: string;
  published_at: string | null;
  author?: { login?: string } | null;
}

/**
 * Fetch curated activity for one repo since `sinceIso` (exclusive). Returns
 * events newest-first, capped at `max`. Each PR/issue yields at most one event
 * (its latest state change after the cursor), so a busy repo doesn't spam the
 * feed with every intermediate transition.
 */
export async function fetchGithubActivity(opts: {
  repo: string;
  token: string;
  sinceIso: string | null;
  max?: number;
}): Promise<SourceEvent[]> {
  const parsed = parseOwnerRepo(opts.repo);
  if (!parsed) return [];
  const { owner, name } = parsed;
  const repo = `${owner}/${name}`;
  const max = opts.max ?? 15;
  const since = opts.sinceIso ? new Date(opts.sinceIso).getTime() : 0;
  const after = (iso: string | null | undefined): boolean =>
    Boolean(iso) && new Date(iso as string).getTime() > since;

  const events: SourceEvent[] = [];

  // Pull requests — one event per PR: merged > closed > opened, whichever
  // transition happened after the cursor.
  const pulls = (await ghGet(`/repos/${repo}/pulls`, opts.token, {
    state: "all",
    sort: "updated",
    direction: "desc",
    per_page: 30,
  })) as GhPull[];
  for (const pr of pulls) {
    if (isBotActor(pr.user?.login)) continue;
    const ref = `${repo}#${pr.number}`;
    if (after(pr.merged_at)) {
      events.push({
        source: "github", artifact: "pr", event: "pr_merged", repo,
        title: `PR merged: "${pr.title}" (#${pr.number})`,
        url: pr.html_url, ref, actor: pr.user?.login ?? null, ts: pr.merged_at as string,
      });
    } else if (after(pr.closed_at) && !pr.merged_at) {
      events.push({
        source: "github", artifact: "pr", event: "pr_closed", repo,
        title: `PR closed: "${pr.title}" (#${pr.number})`,
        url: pr.html_url, ref, actor: pr.user?.login ?? null, ts: pr.closed_at as string,
      });
    } else if (after(pr.created_at)) {
      events.push({
        source: "github", artifact: "pr", event: "pr_opened", repo,
        title: `New PR: "${pr.title}" (#${pr.number})`,
        url: pr.html_url, ref, actor: pr.user?.login ?? null, ts: pr.created_at,
      });
    }
  }

  // Issues — the issues endpoint also returns PRs; filter those out.
  const issues = (await ghGet(`/repos/${repo}/issues`, opts.token, {
    state: "all",
    sort: "updated",
    direction: "desc",
    per_page: 30,
    ...(opts.sinceIso ? { since: opts.sinceIso } : {}),
  })) as GhIssue[];
  for (const it of issues) {
    if (it.pull_request || isBotActor(it.user?.login)) continue;
    const ref = `${repo}#${it.number}`;
    if (after(it.closed_at)) {
      events.push({
        source: "github", artifact: "issue", event: "issue_closed", repo,
        title: `Issue closed: "${it.title}" (#${it.number})`,
        url: it.html_url, ref, actor: it.user?.login ?? null, ts: it.closed_at as string,
      });
    } else if (after(it.created_at)) {
      events.push({
        source: "github", artifact: "issue", event: "issue_opened", repo,
        title: `Issue opened: "${it.title}" (#${it.number})`,
        url: it.html_url, ref, actor: it.user?.login ?? null, ts: it.created_at,
      });
    }
  }

  // Releases.
  const releases = (await ghGet(`/repos/${repo}/releases`, opts.token, {
    per_page: 10,
  })) as GhRelease[];
  for (const rel of releases) {
    if (!after(rel.published_at)) continue;
    const label = rel.name || rel.tag_name;
    events.push({
      source: "github", artifact: "release", event: "release_published", repo,
      title: `Release published: ${label}`,
      url: rel.html_url, ref: `${repo}@${rel.tag_name}`,
      actor: rel.author?.login ?? null, ts: rel.published_at as string,
    });
  }

  events.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
  return events.slice(0, max);
}

/** Build a provenance array for an event. PR/issue map to a typed ref; releases
 * and commits carry none — the primitive's provenance vocabulary
 * (pr|commit|issue|page|message) has no release type, and commit refs aren't
 * emitted yet. */
const PROVENANCE_TYPE: Partial<Record<SourceEvent["artifact"], EventProvenance["type"]>> = {
  pr: "pr",
  issue: "issue",
  commit: "commit",
};

export function provenanceFor(ev: SourceEvent): EventProvenance[] {
  const type = PROVENANCE_TYPE[ev.artifact];
  return type ? prov(type, ev.ref, ev.url) : [];
}
