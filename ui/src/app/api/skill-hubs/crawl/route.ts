import { NextRequest, NextResponse } from "next/server";
import {
  withAuth,
  withErrorHandler,
  requireAdmin,
  validateCredentialsRef,
} from "@/lib/api-middleware";
import { crawlGitHubRepo, crawlGitLabRepo } from "@/lib/hub-crawl";
import { normalizeHubLocation } from "@/app/api/skill-hubs/_lib/normalize";

/**
 * POST /api/skill-hubs/crawl — preview SKILL.md paths for a repo (FR-017).
 * Proxies to Python when NEXT_PUBLIC_A2A_BASE_URL is set; otherwise crawls from Next server.
 * Admin only.
 */
export const POST = withErrorHandler(async (request: NextRequest) => {
  return await withAuth(request, async (_req, _user, session) => {
    requireAdmin(session);

    const body = await request.json();
    const { type, location } = body;
    const credentialsRef = validateCredentialsRef(body.credentials_ref);

    if (!type || !location || typeof location !== "string") {
      return NextResponse.json(
        { error: "bad_request", message: "Missing type or location." },
        { status: 400 },
      );
    }

    // Forward GitHub previews to the Python skills service when configured —
    // it lives co-located with the supervisor and shares its outbound rate
    // budget, which keeps GitHub API quota out of the Next.js process.
    //
    // GitLab previews are intentionally NOT forwarded: the Python endpoint
    // returns 501 for gitlab (see ai_platform_engineering/skills_middleware
    // /router.py — GitLab support lives only in the UI's `crawlGitLabRepo`
    // because subgroup-aware path handling and PRIVATE-TOKEN headers are
    // already implemented here). Falling through to the local crawler keeps
    // the preview button working end-to-end without touching Python.
    const backendUrl = process.env.NEXT_PUBLIC_A2A_BASE_URL;
    if (backendUrl && type === "github") {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (session.accessToken) {
        headers["Authorization"] = `Bearer ${session.accessToken}`;
      }
      const url = new URL("/skill-hubs/crawl", backendUrl).toString();
      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          type,
          location: location.trim(),
          credentials_ref: credentialsRef,
        }),
        signal: AbortSignal.timeout(60_000),
      });
      const data = await res.json().catch(() => ({}));
      return NextResponse.json(data, { status: res.status });
    }

    // Local fallback (Python service not configured, OR type === "gitlab").
    //
    // The preview button accepts whatever the admin types — typically a
    // full URL (`https://gitlab.com/group/sub/project`) rather than the
    // canonical `group/sub/project`. The shared `normalizeHubLocation`
    // collapses both to the form the crawlers expect: GitHub stays flat
    // (`owner/repo`); GitLab preserves subgroup nesting. Without this,
    // GitLab crawls hit `encodeURIComponent` against a full URL and
    // produce 404s from the GitLab API (the project lookup `/projects/
    // <id-or-encoded-path>` cannot resolve a URL-encoded URL).
    const maxPreview = 100;
    const normalizedLocation = normalizeHubLocation(
      location.trim(),
      type === "gitlab" ? "gitlab" : "github",
    );
    try {
      if (type === "github") {
        const [owner, repo] = normalizedLocation.split("/").filter(Boolean);
        if (!owner || !repo) {
          return NextResponse.json(
            { error: "invalid_location", message: "Expected owner/repo." },
            { status: 400 },
          );
        }
        const token = (credentialsRef ? process.env[credentialsRef] : undefined)
          || process.env.GITHUB_TOKEN;

        const crawled = await crawlGitHubRepo(owner, repo, token);
        const sliced = crawled.slice(0, maxPreview);
        return NextResponse.json({
          paths: sliced.map((s) => s.path),
          skills_preview: sliced.map((s) => ({
            path: s.path,
            name: s.name,
            description: s.description,
          })),
          error: null,
        });
      }

      if (type === "gitlab") {
        // Reject anything that still looks like a URL after normalization
        // (defensive: covers self-hosted hosts not in the GITLAB_API_URL
        // allow-list which `normalizeHubLocation` deliberately leaves
        // unchanged so we don't smuggle attacker-controlled hosts past
        // it). A URL here would silently produce 404s downstream.
        if (
          normalizedLocation.includes("://") ||
          !normalizedLocation.includes("/")
        ) {
          return NextResponse.json(
            {
              error: "invalid_location",
              message:
                "Expected a GitLab project path like 'group/project' or 'group/subgroup/project'. Self-hosted GitLab hosts must be configured via GITLAB_API_URL.",
            },
            { status: 400 },
          );
        }

        const token = (credentialsRef ? process.env[credentialsRef] : undefined)
          || process.env.GITLAB_TOKEN;

        const crawled = await crawlGitLabRepo(normalizedLocation, token);
        const sliced = crawled.slice(0, maxPreview);
        return NextResponse.json({
          paths: sliced.map((s) => s.path),
          skills_preview: sliced.map((s) => ({
            path: s.path,
            name: s.name,
            description: s.description,
          })),
          error: null,
        });
      }

      return NextResponse.json(
        { error: "unsupported_type", message: `Type not supported: ${type}` },
        { status: 400 },
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return NextResponse.json(
        { paths: [], skills_preview: [], error: message },
        { status: 502 },
      );
    }
  });
});
