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
import type { HubSkillDoc, SkillHubDoc } from "@/lib/hub-crawl";

const STORAGE_TYPE = isMongoDBConfigured ? "mongodb" : "none";

/**
 * POST /api/skills/hub/[hubId]/[skillId]/scan
 *
 * Re-runs skill-scanner on the cached SKILL.md for a hub-crawled skill.
 * Persists `scan_status`, `scan_summary`, `scan_updated_at` onto the
 * `hub_skills` cache doc so the gallery shield reflects the latest state.
 *
 * Permission: any authenticated user (hub catalogs are global / read-only).
 */
export const POST = withErrorHandler(
  async (
    request: NextRequest,
    context: { params: Promise<{ hubId: string; skillId: string }> },
  ) => {
    if (STORAGE_TYPE !== "mongodb") {
      throw new ApiError("Skill hubs require MongoDB to be configured", 503);
    }

    const { hubId, skillId } = await context.params;
    if (!hubId || !skillId) {
      throw new ApiError("hubId and skillId are required", 400);
    }

    return await withAuth(request, async (_req, user) => {
      const hubsCol = await getCollection<SkillHubDoc>("skill_hubs");
      const hub = await hubsCol.findOne({ id: hubId });
      if (!hub) {
        throw new ApiError("Skill hub not found", 404);
      }

      const hubSkillsCol = await getCollection<HubSkillDoc>("hub_skills");
      const doc = await hubSkillsCol.findOne({
        hub_id: hubId,
        skill_id: skillId,
      });
      if (!doc) {
        throw new ApiError(
          "Skill not found in hub cache. The hub may need to be re-crawled.",
          404,
        );
      }

      const content = doc.content?.trim();
      if (!content) {
        throw new ApiError(
          "No SKILL.md content cached for this hub skill.",
          400,
        );
      }

      if (!isSkillScannerConfigured()) {
        throw new ApiError(
          "Scanner is not configured. Set SKILL_SCANNER_URL (e.g. http://skill-scanner:8000) so the UI can reach the standalone skill-scanner service.",
          503,
        );
      }

      const t0 = Date.now();
      const scanResult = await scanSkillContent(
        doc.name,
        content,
        `hub-${hubId}-${skillId}`,
        {
          // Bundle ancillary files captured during crawl so the scanner
          // analyzes the same surface the agent runtime materializes
          // (see `skills_middleware/backend_sync.py`).
          ancillaryFiles: doc.ancillary_files,
        },
      );
      const now = new Date();
      // Surface the unscanned reason (empty content / scanner timeout
      // / HTTP error) to admins via scan_summary instead of leaving
      // the workspace Scan tab silent.
      const persistedSummary =
        scanResult.scan_summary ?? scanResult.unscanned_reason;

      await recordScanEvent({
        trigger: "manual_hub_skill",
        skill_id: `hub-${hubId}-${skillId}`,
        skill_name: doc.name,
        source: "hub",
        hub_id: hubId,
        actor: user.email,
        scan_status: scanResult.scan_status,
        scan_summary: persistedSummary,
        scanner_unavailable: scanResult.scan_status === "unscanned",
        duration_ms: Date.now() - t0,
      });

      // Auto-revert an active admin override when the rescan now
      // returns a clean ("passed") verdict. Same pattern as the
      // agent_skills rescan route (see configs/[id]/scan for the
      // full rationale): the override was the admin's "I trust
      // this even though the scanner doesn't" assertion; once the
      // scanner agrees, the assertion is moot. We clear the
      // override sub-doc atomically with the status update so
      // the doc never lingers in a "passed but still has override"
      // state, and write a ``clear`` audit row attributed to
      // ``system:scanner`` to complete the audit chain.
      const wasOverridden =
        doc.scan_status === "admin_overridden" && doc.scan_override;
      const shouldAutoRevertOverride =
        Boolean(wasOverridden) && scanResult.scan_status === "passed";

      const setUpdate: Record<string, unknown> = {
        scan_status: scanResult.scan_status,
        ...(persistedSummary !== undefined
          ? { scan_summary: persistedSummary }
          : {}),
        scan_updated_at: now,
      };

      if (shouldAutoRevertOverride) {
        await hubSkillsCol.updateOne(
          { hub_id: hubId, skill_id: skillId },
          {
            $set: setUpdate,
            $unset: { scan_override: "" },
          },
        );
        // Best-effort audit row. Helper swallows write failures so
        // a Mongo blip can't block the rescan response.
        await recordScanOverrideEvent({
          action: "clear",
          skill_id: skillId,
          skill_name: doc.name,
          source: "hub",
          hub_id: hubId,
          actor: "system:scanner",
          reason: "Scanner returned passed",
          prior_scan_status: "admin_overridden",
          prior_scan_summary: doc.scan_summary,
        });
      } else {
        await hubSkillsCol.updateOne(
          { hub_id: hubId, skill_id: skillId },
          { $set: setUpdate },
        );
      }

      return successResponse({
        id: `hub-${hubId}-${skillId}`,
        scan_status: scanResult.scan_status,
        scan_summary: persistedSummary,
        scan_updated_at: now.toISOString(),
        // The UI's SkillScanStatusIndicator looks at
        // ``override_auto_cleared`` to decide whether to drop the
        // local ``scan_override`` cache; mirror the agent_skills
        // shape so the same client logic works for hub rescans.
        ...(shouldAutoRevertOverride
          ? { override_auto_cleared: true as const }
          : {}),
      });
    });
  },
);
