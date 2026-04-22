import { NextRequest, NextResponse } from "next/server";
import {
  withAuth,
  withErrorHandler,
  requireAdmin,
  validateCredentialsRef,
} from "@/lib/api-middleware";
import { crawlGitHubRepo, crawlGitLabRepo } from "@/lib/hub-crawl";

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

    const backendUrl = process.env.NEXT_PUBLIC_A2A_BASE_URL;
    if (backendUrl) {
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

    // Local fallback (no Python skills service)
    const maxPreview = 100;
    try {
      if (type === "github") {
        let loc = location.trim();
        try {
          const parsed = new URL(loc);
          if (parsed.hostname === "github.com" || parsed.hostname.endsWith(".github.com")) {
            loc = parsed.pathname.replace(/^\/+|\/+$/g, "");
          }
        } catch { /* not a URL */ }
        const [owner, repo] = loc.split("/").filter(Boolean);
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
        const token = (credentialsRef ? process.env[credentialsRef] : undefined)
          || process.env.GITLAB_TOKEN;

        const crawled = await crawlGitLabRepo(location.trim(), token);
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
