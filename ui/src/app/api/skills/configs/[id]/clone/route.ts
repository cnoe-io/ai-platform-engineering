import { NextRequest } from "next/server";

import {
  withAuth,
  withErrorHandler,
  successResponse,
  ApiError,
} from "@/lib/api-middleware";
import { getCollection, isMongoDBConfigured } from "@/lib/mongodb";
import { getAgentSkillVisibleToUser } from "@/lib/agent-skill-visibility";
import { scanSkillContent as runSkillScan } from "@/lib/skill-scan";
import { recordScanEvent } from "@/lib/skill-scan-history";
import type { AgentSkill } from "@/types/agent-skill";

/**
 * POST /api/skills/configs/[id]/clone
 *
 * Escape hatch for the built-in mutation lock. Produces an editable
 * user-owned copy of any visible skill (built-in, custom, or hub
 * cached) without granting write access to the original.
 *
 * The clone:
 *   * Gets a brand-new id (``skill-<slug>-<random>``).
 *   * Sets ``is_system: false`` so the user can edit it freely.
 *   * Re-attributes ``owner_id`` to the caller.
 *   * Defaults visibility to ``private`` (callers can publish later).
 *   * Copies SKILL.md content + ancillary files verbatim.
 *   * Re-runs the scanner on the copy so the new row gets its own
 *     scan_status (the source row's status doesn't transfer — the
 *     copy is logically a new artifact and policy must re-evaluate).
 *
 * Permissions: any user who can read the source (per
 * ``getAgentSkillVisibleToUser``) can clone it. The built-in lock
 * deliberately does **not** apply here — the whole point of clone
 * is to produce an unlocked copy.
 */
export const POST = withErrorHandler(
  async (
    request: NextRequest,
    context: { params: Promise<{ id: string }> },
  ) => {
    if (!isMongoDBConfigured) {
      throw new ApiError("Skills require MongoDB to be configured", 503);
    }
    const { id } = await context.params;
    if (!id) {
      throw new ApiError("Source skill id is required", 400);
    }

    return await withAuth(request, async (_req, user) => {
      const source = await getAgentSkillVisibleToUser(id, user.email);
      if (!source) {
        // 404 (not 403) so we don't leak existence of skills the
        // caller can't see.
        throw new ApiError("Skill not found", 404);
      }

      // Optional caller overrides via JSON body (name + description).
      // If the body is missing or invalid we just default to
      // ``"<original> (copy)"`` so the clone button works as a
      // one-click action from the gallery.
      let body: { name?: string; description?: string } = {};
      try {
        body = (await request.json()) as { name?: string; description?: string };
      } catch {
        // empty body is fine
      }

      const clonedName =
        (body.name?.trim() || `${source.name} (copy)`).slice(0, 200);
      const clonedDescription =
        body.description?.trim() ?? source.description ?? "";

      const slug = clonedName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");
      const newId = `skill-${slug}-${Math.random().toString(36).slice(2, 11)}`;
      const now = new Date();

      const cloned: AgentSkill = {
        id: newId,
        name: clonedName,
        description: clonedDescription,
        category: source.category,
        tasks: source.tasks ?? [],
        owner_id: user.email,
        is_system: false,
        created_at: now,
        updated_at: now,
        metadata: {
          ...(source.metadata ?? {}),
          // Keep a breadcrumb so we can answer "where did this come
          // from?" without joining audit logs. Useful when a clone
          // diverges from the source over time.
          template_source_id: id,
          import_kind: source.is_system ? "clone_of_builtin" : "clone_of_user",
        },
        visibility: "private",
        shared_with_teams: undefined,
        skill_content: source.skill_content,
        is_quick_start: source.is_quick_start,
        difficulty: source.difficulty,
        thumbnail: source.thumbnail,
        input_form: source.input_form,
        ancillary_files: source.ancillary_files
          ? { ...source.ancillary_files }
          : undefined,
      };

      // Re-scan: a clone is a new artifact and must be evaluated
      // by current policy on its own. Don't inherit the source's
      // scan_status — it could be stale, and an admin who clones a
      // failing built-in to fix it should see the failure persist
      // until the fix lands.
      const t0 = Date.now();
      const scanResult = await runSkillScan(
        cloned.name,
        cloned.skill_content || "",
        newId,
      );
      cloned.scan_status = scanResult.scan_status;
      if (scanResult.scan_summary !== undefined) {
        cloned.scan_summary = scanResult.scan_summary;
      }
      if (cloned.skill_content?.trim()) {
        cloned.scan_updated_at = new Date();
      }

      const collection = await getCollection<AgentSkill>("agent_skills");
      await collection.insertOne(cloned);

      await recordScanEvent({
        trigger: "clone",
        skill_id: newId,
        skill_name: cloned.name,
        source: "agent_skills",
        actor: user.email,
        scan_status: scanResult.scan_status,
        scan_summary: scanResult.scan_summary,
        scanner_unavailable:
          !cloned.skill_content?.trim() ||
          scanResult.scan_status === "unscanned",
        duration_ms: Date.now() - t0,
      });

      console.log(
        `[AgentSkill] Cloned "${id}" → "${newId}" by ${user.email} (source.is_system=${source.is_system})`,
      );

      return successResponse(
        {
          id: newId,
          source_id: id,
          name: cloned.name,
          scan_status: cloned.scan_status,
          scan_summary: cloned.scan_summary,
          message: "Skill cloned successfully",
        },
        201,
      );
    });
  },
);
