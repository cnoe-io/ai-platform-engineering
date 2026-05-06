import { NextRequest, NextResponse } from "next/server";
import { getCollection, isMongoDBConfigured } from "@/lib/mongodb";
import {
  withAuth,
  withErrorHandler,
  requireAdmin,
  ApiError,
} from "@/lib/api-middleware";
import { getHubSkills, resolveHubToken } from "@/lib/hub-crawl";
import type { SkillHubDoc } from "@/lib/hub-crawl";
import {
  apiHostFromBaseUrl,
  buildCrawlStreamResponse,
  wantsNdjsonStream,
} from "@/app/api/skill-hubs/_lib/crawl-stream-response";

/**
 * POST /api/skill-hubs/[id]/refresh
 *
 * Force-recrawl a hub, bypassing the MongoDB cache. Writes fresh skill
 * content into `hub_skills` and removes skills no longer present in the repo.
 * Admin only.
 *
 * Content-negotiated response:
 *   - Default (``Accept: application/json``):
 *       200  { skills_count: number, hub_id: string }
 *       404  hub not found
 *       503  MongoDB not configured
 *   - Streaming (``Accept: application/x-ndjson``): NDJSON event
 *     stream emitting ``started``, per-fetch ``request``, ``page``,
 *     ``skill_found``, ``warning``, and a terminal ``done`` / ``error``
 *     event. The full encoded log is also persisted to
 *     ``hub.last_crawl_log`` (capped) so the admin can re-open the
 *     last run via "View last crawl" without re-running it.
 */
export const POST = withErrorHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    if (!isMongoDBConfigured) {
      throw new ApiError("Skill hubs require MongoDB to be configured", 503);
    }

    return await withAuth(request, async (_req, _user, session) => {
      requireAdmin(session);

      const { id } = await context.params;

      const collection = await getCollection("skill_hubs");
      const hubDoc = await collection.findOne({ id });
      if (!hubDoc) {
        throw new ApiError(`Hub not found: ${id}`, 404);
      }

      const { _id, ...rest } = hubDoc as Record<string, unknown> & {
        _id?: unknown;
      };
      const hub = rest as unknown as SkillHubDoc;

      if (wantsNdjsonStream(request)) {
        // Streaming branch: feed the emitter through getHubSkills,
        // persist the encoded log on the hub doc when the crawl
        // completes. The streaming response stays open for the
        // duration of the crawl; the controller closes it from
        // inside the helper after the terminal event.
        const project =
          hub.type === "github"
            ? hub.location.replace(/^https?:\/\/[^/]+\//, "")
            : hub.location;
        const baseUrl =
          hub.type === "github"
            ? "https://api.github.com"
            : process.env.GITLAB_API_URL || "https://gitlab.com/api/v4";

        return buildCrawlStreamResponse({
          provider: hub.type,
          project,
          api_host: apiHostFromBaseUrl(baseUrl),
          run: async (emitter) => {
            const skills = await getHubSkills(
              hub,
              /* forceFresh */ true,
              emitter,
            );
            // The crawl helpers already record ``last_truncation`` on
            // the hub doc; surface it through the ``done`` event so
            // the dialog matches the row badge.
            const refreshedHub = await collection.findOne({ id });
            const truncation =
              (refreshedHub as { last_truncation?: SkillHubDoc["last_truncation"] } | null)
                ?.last_truncation ?? { kind: "ok", pages_walked: 0 };
            return { skills: skills.length, truncation };
          },
          // Auto-introspect on GitLab auth failure to produce the
          // precise scope-mismatch hint inline. Skipped for GitHub
          // hubs; the introspection module is GitLab-specific.
          ...(hub.type === "gitlab"
            ? { gitlabIntrospect: { baseUrl, token: resolveHubToken(hub) } }
            : {}),
          persistLog: async (log) => {
            await collection.updateOne(
              { id },
              {
                $set: {
                  last_crawl_log: log,
                  last_crawl_log_at: new Date().toISOString(),
                },
              },
            );
          },
        }) as unknown as NextResponse;
      }

      const skills = await getHubSkills(hub, /* forceFresh */ true);

      return NextResponse.json({ hub_id: id, skills_count: skills.length });
    });
  },
);
