import { NextRequest } from "next/server";
import { getCollection, isMongoDBConfigured } from "@/lib/mongodb";
import {
  withAuth,
  withErrorHandler,
  successResponse,
  ApiError,
} from "@/lib/api-middleware";
import { scanSkillContent, isSkillScannerConfigured } from "@/lib/skill-scan";
import { recordScanEvent } from "@/lib/skill-scan-history";
import {
  getAgentSkillVisibleToUser,
  userCanModifyAgentSkill,
} from "@/lib/agent-skill-visibility";
import type { AgentSkill } from "@/types/agent-skill";

const STORAGE_TYPE = isMongoDBConfigured ? "mongodb" : "none";

const SUPERVISOR_URL = process.env.NEXT_PUBLIC_A2A_BASE_URL || "";

/**
 * Prefer persisted SKILL.md (`skill_content`). If missing (e.g. workflow-only saves),
 * synthesize minimal markdown from task `llm_prompt` so manual scan still runs.
 */
function resolveSkillMarkdownForScan(skill: AgentSkill): string {
  const fromBuilder = skill.skill_content?.trim();
  if (fromBuilder) return fromBuilder;

  const prompts = (skill.tasks ?? [])
    .map((t) => t?.llm_prompt?.trim())
    .filter((p): p is string => Boolean(p));
  if (prompts.length === 0) return "";

  const title = skill.name?.trim() || skill.id;
  const head = `# ${title}\n\n`;
  const desc = skill.description?.trim() ? `${skill.description.trim()}\n\n` : "";
  if (prompts.length === 1) {
    return `${head}${desc}${prompts[0]}`;
  }
  const body = prompts
    .map((p, i) => `## Step ${i + 1}\n\n${p}`)
    .join("\n\n---\n\n");
  return `${head}${desc}${body}`;
}

/**
 * Background-fire a supervisor catalog refresh after a successful scan.
 * Forwards the caller's credentials so the supervisor's auth gate
 * (`get_catalog_auth` — JWT or `X-Caipe-Catalog-Key`) doesn't reject us
 * with 401 the moment `OIDC_ISSUER` is set on the supervisor side. See
 * `scanSkillContent` for the same auth pattern on the synchronous call.
 */
function triggerSupervisorRefresh(auth?: {
  accessToken?: string;
  catalogKey?: string;
}): void {
  if (!SUPERVISOR_URL) return;
  const headers: Record<string, string> = {};
  if (auth?.accessToken) headers["Authorization"] = `Bearer ${auth.accessToken}`;
  if (auth?.catalogKey) headers["X-Caipe-Catalog-Key"] = auth.catalogKey;
  fetch(`${SUPERVISOR_URL}/skills/refresh?include_hubs=false`, {
    method: "POST",
    headers,
    signal: AbortSignal.timeout(30_000),
  }).catch((err) => {
    console.warn("[ScanSkill] Background supervisor refresh failed:", err);
  });
}

/**
 * POST /api/skills/configs/[id]/scan
 *
 * Re-runs skill-scanner on persisted SKILL.md for Mongo-backed skills.
 * Same permission as editing the skill (owner for user skills; any authenticated user for built-in rows).
 */
export const POST = withErrorHandler(
  async (
    request: NextRequest,
    context: { params: Promise<{ id: string }> },
  ) => {
    if (STORAGE_TYPE !== "mongodb") {
      throw new ApiError("Skills requires MongoDB to be configured", 503);
    }

    const { id } = await context.params;
    if (!id) {
      throw new ApiError("Config id is required", 400);
    }

    return await withAuth(request, async (req, user, session) => {
      const existing = await getAgentSkillVisibleToUser(id, user.email);
      if (!existing) {
        throw new ApiError("Agent config not found", 404);
      }

      if (!userCanModifyAgentSkill(existing, user)) {
        throw new ApiError("You don't have permission to scan this skill", 403);
      }

      const content = resolveSkillMarkdownForScan(existing);
      if (!content) {
        throw new ApiError(
          "No scannable text for this skill. Add SKILL.md in Skills Builder or task prompts in the workflow editor, save, then scan again.",
          400,
        );
      }

      if (!isSkillScannerConfigured()) {
        throw new ApiError(
          "Scanner is not configured. Set SKILL_SCANNER_URL (e.g. http://skill-scanner:8000) so the UI can reach the standalone skill-scanner service.",
          503,
        );
      }

      // The supervisor catalog refresh below still needs the user's
      // creds (its `/skills/refresh` is JWT-gated when OIDC is on); the
      // scan call itself goes to the unauthenticated internal scanner.
      const supervisorAuth = {
        accessToken: (session as { accessToken?: string } | null | undefined)
          ?.accessToken,
        catalogKey: req.headers.get("x-caipe-catalog-key") ?? undefined,
      };

      const t0 = Date.now();
      const scanResult = await scanSkillContent(existing.name, content, id);
      const now = new Date();

      await recordScanEvent({
        trigger: "manual_user_skill",
        skill_id: id,
        skill_name: existing.name,
        source: existing.is_system ? "default" : "agent_skills",
        actor: user.email,
        scan_status: scanResult.scan_status,
        scan_summary: scanResult.scan_summary,
        scanner_unavailable: scanResult.scan_status === "unscanned",
        duration_ms: Date.now() - t0,
      });

      const collection = await getCollection<AgentSkill>("agent_skills");
      await collection.updateOne(
        { id },
        {
          $set: {
            scan_status: scanResult.scan_status,
            ...(scanResult.scan_summary !== undefined
              ? { scan_summary: scanResult.scan_summary }
              : {}),
            scan_updated_at: now,
            updated_at: now,
          },
        },
      );

      triggerSupervisorRefresh(supervisorAuth);

      return successResponse({
        id,
        scan_status: scanResult.scan_status,
        scan_summary: scanResult.scan_summary,
        scan_updated_at: now.toISOString(),
      });
    });
  },
);
