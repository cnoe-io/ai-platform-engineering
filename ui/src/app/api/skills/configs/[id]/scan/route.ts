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
import { recordScanOverrideEvent } from "@/lib/skill-scan-override-history";
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
      const scanResult = await scanSkillContent(existing.name, content, id, {
        // Include ancillary files so the scanner sees the same files
        // the agent runtime injects into the StateBackend at
        // /skills/<source>/<name>/<rel_path>. Without this, scripts /
        // prompts referenced from SKILL.md would never be analyzed.
        ancillaryFiles: existing.ancillary_files,
      });
      const now = new Date();
      // Persist the unscanned reason so the workspace Scan tab can
      // explain *why* (empty content, scanner timeout, HTTP error)
      // instead of leaving the user staring at a grey badge.
      const persistedSummary =
        scanResult.scan_summary ?? scanResult.unscanned_reason;

      await recordScanEvent({
        trigger: "manual_user_skill",
        skill_id: id,
        skill_name: existing.name,
        source: existing.is_system ? "default" : "agent_skills",
        actor: user.email,
        scan_status: scanResult.scan_status,
        scan_summary: persistedSummary,
        scanner_unavailable: scanResult.scan_status === "unscanned",
        duration_ms: Date.now() - t0,
      });

      const collection = await getCollection<AgentSkill>("agent_skills");

      // Auto-revert an existing admin override when the rescan now
      // returns a clean ("passed") verdict. The override was the
      // admin's "I trust this even though the scanner doesn't"
      // assertion; once the scanner agrees, the assertion is
      // moot — leaving the override in place would create stale
      // audit records (an active override on a passing skill,
      // confusing for reviewers). We clear the override sub-doc
      // and record a `clear` audit row attributed to
      // ``system:scanner`` so the audit chain is complete.
      //
      // If the rescan still flags or comes back unscanned, we
      // intentionally do NOT touch the override: the admin's
      // assertion still applies, and the catalog continues to serve
      // the skill (subject to ``ADMIN_SCAN_OVERRIDE_ENABLED``).
      const wasOverridden =
        existing.scan_status === "admin_overridden" && existing.scan_override;
      const shouldAutoRevertOverride =
        wasOverridden && scanResult.scan_status === "passed";

      const setUpdate: Record<string, unknown> = {
        scan_status: scanResult.scan_status,
        ...(persistedSummary !== undefined
          ? { scan_summary: persistedSummary }
          : {}),
        scan_updated_at: now,
        updated_at: now,
      };

      if (shouldAutoRevertOverride) {
        // The single update both replaces the status with
        // ``"passed"`` (above) AND drops the override sub-doc, so
        // the doc never lingers in a "passed but still has
        // override" state.
        await collection.updateOne(
          { id },
          {
            $set: setUpdate,
            $unset: { scan_override: "" },
          },
        );
        // Best-effort audit row. Swallowed by the helper on
        // failure — never blocks the rescan response.
        await recordScanOverrideEvent({
          action: "clear",
          skill_id: id,
          skill_name: existing.name,
          source: existing.is_system ? "default" : "agent_skills",
          actor: "system:scanner",
          reason: "Scanner returned passed",
          prior_scan_status: "admin_overridden",
          prior_scan_summary: existing.scan_summary,
        });
      } else {
        await collection.updateOne({ id }, { $set: setUpdate });
      }

      triggerSupervisorRefresh(supervisorAuth);

      return successResponse({
        id,
        scan_status: scanResult.scan_status,
        scan_summary: persistedSummary,
        scan_updated_at: now.toISOString(),
        ...(shouldAutoRevertOverride
          ? { override_auto_cleared: true as const }
          : {}),
      });
    });
  },
);
