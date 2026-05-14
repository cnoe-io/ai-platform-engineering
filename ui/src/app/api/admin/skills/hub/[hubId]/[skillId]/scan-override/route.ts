/**
 * Admin scan-override route — hub source.
 *
 * Companion to ``app/api/admin/skills/[source]/[source_id]/scan-override``
 * (which only handles ``source = "agent_skills"``). Hub skills live in
 * the ``hub_skills`` cache collection with a composite ``(hub_id,
 * skill_id)`` key, so they need their own URL shape rather than
 * being shoe-horned through the single-id route. Symmetric to
 * ``/api/skills/hub/[hubId]/[skillId]/scan`` so admins building URL
 * intuition only have to learn one path layout for hub admin actions.
 *
 * Two methods, mirror-image of the agent_skills variant:
 *
 *   POST   ``/api/admin/skills/hub/:hubId/:skillId/scan-override``
 *          — set an override. Requires ``reason`` in the body.
 *   DELETE ``/api/admin/skills/hub/:hubId/:skillId/scan-override``
 *          — clear an override. Optional ``reason`` for the audit row.
 *
 * The audit log is shared with agent_skills (single
 * ``skill_scan_override_history`` collection, discriminated by the
 * ``source`` field) so an admin reviewing all overrides ever set
 * can do it in a single query — see ``recordScanOverrideEvent`` for
 * the rationale.
 *
 * Gates (identical to the agent_skills variant; copy-paste because
 * the two routes have to stay byte-equivalent on policy or someone
 * will eventually exploit the gap):
 *   - ``admin_ui#admin`` RBAC permission
 *   - ``ADMIN_SCAN_OVERRIDE_ENABLED !== "false"`` (POST only — DELETE
 *     remains open even when the feature is off so stuck overrides
 *     can be cleaned up; matches the agent_skills route)
 *   - Mongo configured
 *
 * assisted-by Cursor Composer-Sonnet-4.7
 */

import { NextRequest, NextResponse } from "next/server";
import {
  getAuthFromBearerOrSession,
  withErrorHandler,
  successResponse,
  requireRbacPermission,
  ApiError,
} from "@/lib/api-middleware";
import { getCollection, isMongoDBConfigured } from "@/lib/mongodb";
import { recordScanOverrideEvent } from "@/lib/skill-scan-override-history";
import type { HubSkillDoc, SkillHubDoc } from "@/lib/hub-crawl";
import type { ScanOverride } from "@/types/agent-skill";

const SUPERVISOR_URL = process.env.NEXT_PUBLIC_A2A_BASE_URL || "";

/**
 * Whether the admin override feature is on. MUST stay byte-identical
 * to the same helper in ``[source]/[source_id]/scan-override/route.ts``
 * — that's why this looks like a copy. If a third reader appears
 * we'll centralise into ``@/lib/scan-override-flag`` per the comment
 * on the agent_skills variant.
 */
function isAdminOverrideEnabled(): boolean {
  const raw = (process.env.ADMIN_SCAN_OVERRIDE_ENABLED ?? "true")
    .trim()
    .toLowerCase();
  return !["false", "0", "no", "off"].includes(raw);
}

/**
 * Background-fire a supervisor catalog refresh. Same rationale as
 * the agent_skills route — the override changes what the runtime
 * is willing to serve, so the supervisor's catalog cache must
 * re-pull. Hub overrides DO need ``include_hubs=true`` here since
 * the override lives on the hub doc and a non-hub-aware refresh
 * wouldn't pick it up.
 */
function triggerSupervisorRefresh(auth?: {
  accessToken?: string;
  catalogKey?: string;
}): void {
  if (!SUPERVISOR_URL) return;
  const headers: Record<string, string> = {};
  if (auth?.accessToken) headers["Authorization"] = `Bearer ${auth.accessToken}`;
  if (auth?.catalogKey) headers["X-Caipe-Catalog-Key"] = auth.catalogKey;
  fetch(`${SUPERVISOR_URL}/skills/refresh?include_hubs=true`, {
    method: "POST",
    headers,
    signal: AbortSignal.timeout(30_000),
  }).catch((err) => {
    console.warn(
      "[ScanOverride.hub] Background supervisor refresh failed:",
      err,
    );
  });
}

/**
 * POST — create or update an admin scan override on a hub skill.
 *
 * Preconditions:
 *   - Admin role.
 *   - ``ADMIN_SCAN_OVERRIDE_ENABLED !== false``.
 *   - Mongo configured.
 *   - Hub doc exists.
 *   - Hub skill is in the cache (re-crawl required if not).
 *   - Skill's current ``scan_status`` is ``"flagged"``.
 *
 * On success returns the new ``scan_status`` + ``scan_override``
 * sub-doc so the gallery dialog can update without an extra GET.
 */
export const POST = withErrorHandler(
  async (
    request: NextRequest,
    context: { params: Promise<{ hubId: string; skillId: string }> },
  ) => {
    if (!isMongoDBConfigured) {
      throw new ApiError(
        "MongoDB is required for scan overrides (the admin escape hatch " +
          "writes audit metadata onto persisted hub_skills cache docs).",
        503,
      );
    }
    if (!isAdminOverrideEnabled()) {
      throw new ApiError(
        "Scan overrides are disabled by ADMIN_SCAN_OVERRIDE_ENABLED=false. " +
          "Flip the env var to true on both the UI and supervisor tiers " +
          "to re-enable the admin escape hatch.",
        503,
      );
    }

    const { hubId, skillId } = await context.params;
    if (!hubId) {
      throw new ApiError("hubId is required in the URL.", 400);
    }
    if (!skillId) {
      throw new ApiError("skillId is required in the URL.", 400);
    }

    const { user, session } = await getAuthFromBearerOrSession(request);
    await requireRbacPermission(session, "admin_ui", "admin");

      // Body validation — same shape as the agent_skills route.
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        throw new ApiError("Request body must be valid JSON.", 400);
      }
      const reasonRaw = (body as { reason?: unknown })?.reason;
      if (typeof reasonRaw !== "string") {
        throw new ApiError(
          'Request body must include a string "reason" field describing ' +
            "why this admin is overriding the scanner verdict (audit log " +
            "requirement).",
          400,
        );
      }
      const reason = reasonRaw.trim();
      if (reason.length === 0) {
        throw new ApiError(
          '"reason" cannot be empty — admins must justify each override.',
          400,
        );
      }
      if (reason.length > 4096) {
        throw new ApiError(
          '"reason" is too long (max 4096 characters).',
          400,
        );
      }

      // Verify the hub itself exists before touching hub_skills so
      // we return a friendly 404 ("hub not found") rather than the
      // misleading "skill not found in hub cache" we'd otherwise
      // get for a stale hubId.
      const hubsCol = await getCollection<SkillHubDoc>("skill_hubs");
      const hub = await hubsCol.findOne({ id: hubId });
      if (!hub) {
        throw new ApiError(
          `Skill hub "${hubId}" not found.`,
          404,
        );
      }

      const hubSkillsCol = await getCollection<HubSkillDoc>("hub_skills");
      const existing = await hubSkillsCol.findOne({
        hub_id: hubId,
        skill_id: skillId,
      });
      if (!existing) {
        throw new ApiError(
          `Skill "${skillId}" not found in hub "${hubId}". The hub may ` +
            `need to be re-crawled before the override can be applied.`,
          404,
        );
      }

      if (existing.scan_status !== "flagged") {
        const current = existing.scan_status ?? "unscanned";
        throw new ApiError(
          `Cannot override a hub skill with scan_status="${current}". ` +
            `Only "flagged" skills can be overridden — passed and ` +
            `unscanned skills are not blocked.`,
          409,
        );
      }
      if (existing.scan_override) {
        throw new ApiError(
          `Hub skill "${skillId}" in hub "${hubId}" already has an ` +
            `active admin override (set by ${existing.scan_override.set_by} ` +
            `at ${existing.scan_override.set_at}). Clear it first via ` +
            `DELETE before stamping a new one.`,
          409,
        );
      }

      const now = new Date();
      const override: ScanOverride = {
        set_by: user.email,
        set_at: now.toISOString(),
        reason,
        prior_scan_status: "flagged",
        ...(existing.scan_summary !== undefined
          ? { prior_scan_summary: existing.scan_summary }
          : {}),
      };

      // We deliberately do NOT touch ``scan_status`` here — the
      // scanner verdict stays "flagged" and ``scan_override``
      // alone signals "admin allowed this" to the runtime gates.
      // Previously this route wrote ``scan_status =
      // "admin_overridden"`` which collided with every scanner
      // write path (recrawl auto-scan via ``scanHubSkillsAsync``,
      // per-skill rescan, scan-all) and silently nuked the
      // override on the next scan. Splitting the signals fixes
      // that class of bug entirely.
      await hubSkillsCol.updateOne(
        { hub_id: hubId, skill_id: skillId },
        {
          $set: {
            scan_override: override,
            // Bump scan_updated_at so the gallery's "Last scan"
            // pill reflects the admin action rather than the
            // stale flagged verdict timestamp.
            scan_updated_at: now,
          },
        },
      );

      await recordScanOverrideEvent({
        action: "set",
        skill_id: skillId,
        skill_name: existing.name,
        source: "hub",
        hub_id: hubId,
        actor: user.email,
        reason,
        prior_scan_status: "flagged",
        prior_scan_summary: existing.scan_summary,
      });

      const supervisorAuth = {
        accessToken: (session as { accessToken?: string } | null | undefined)
          ?.accessToken,
        catalogKey: request.headers.get("x-caipe-catalog-key") ?? undefined,
      };
      triggerSupervisorRefresh(supervisorAuth);

      return successResponse({
        // Use the hub-projected catalog id so the UI can match
        // against the row it's already rendering without an extra
        // lookup. ``CatalogSkill.id`` for hub skills is
        // ``hub-<hubId>-<skillId>`` (see hub-crawl.docToCatalogSkill).
        id: `hub-${hubId}-${skillId}`,
        hub_id: hubId,
        skill_id: skillId,
        // ``scan_status`` is unchanged ("flagged"); the override
        // sub-doc is what signals "runnable" to the gates.
        scan_status: existing.scan_status,
        scan_override: override,
        scan_updated_at: now.toISOString(),
      });
  },
);

/**
 * DELETE — clear an existing admin override on a hub skill.
 *
 * Idempotent: clearing an already-clean skill returns 200 with
 * ``cleared: false`` so a UI that double-fires (slow network /
 * retry) doesn't error.
 *
 * NOTE on env-flag handling: deliberately runs even when
 * ``ADMIN_SCAN_OVERRIDE_ENABLED=false`` — same rationale as the
 * agent_skills DELETE handler. Operators flipping the feature
 * off shouldn't be left with stuck overrides they can't clean up.
 */
export const DELETE = withErrorHandler(
  async (
    request: NextRequest,
    context: { params: Promise<{ hubId: string; skillId: string }> },
  ) => {
    if (!isMongoDBConfigured) {
      throw new ApiError(
        "MongoDB is required for scan overrides.",
        503,
      );
    }

    const { hubId, skillId } = await context.params;
    if (!hubId) {
      throw new ApiError("hubId is required in the URL.", 400);
    }
    if (!skillId) {
      throw new ApiError("skillId is required in the URL.", 400);
    }

    const { user, session } = await getAuthFromBearerOrSession(request);
    await requireRbacPermission(session, "admin_ui", "admin");

      // Optional reason on clear. Same parser as the agent_skills
      // route — tolerate "no body" and "body but no reason field"
      // cleanly.
      let reason: string | undefined;
      try {
        const ct = request.headers.get("content-type") ?? "";
        if (ct.includes("application/json")) {
          const body = (await request.json()) as { reason?: unknown };
          if (typeof body?.reason === "string") {
            const trimmed = body.reason.trim();
            if (trimmed.length > 0 && trimmed.length <= 4096) {
              reason = trimmed;
            }
          }
        }
      } catch {
        // Optional body — ignore parse errors.
      }

      const hubSkillsCol = await getCollection<HubSkillDoc>("hub_skills");
      const existing = await hubSkillsCol.findOne({
        hub_id: hubId,
        skill_id: skillId,
      });
      if (!existing) {
        throw new ApiError(
          `Skill "${skillId}" not found in hub "${hubId}".`,
          404,
        );
      }

      if (!existing.scan_override) {
        // Idempotent no-op.
        return successResponse({
          id: `hub-${hubId}-${skillId}`,
          hub_id: hubId,
          skill_id: skillId,
          cleared: false,
          scan_status: existing.scan_status ?? "unscanned",
        });
      }

      const now = new Date();
      const priorOverride = existing.scan_override;
      const priorScanSummary =
        priorOverride?.prior_scan_summary ?? existing.scan_summary;

      // Drop the override sub-doc only — ``scan_status`` is whatever
      // the scanner last wrote (typically still "flagged"). Restore
      // ``scan_summary`` from the snapshot captured at override
      // time so the UI's "why was this flagged?" panel doesn't go
      // blank if a later scanner write happened to overwrite it.
      // Same semantics as the agent_skills DELETE handler.
      await hubSkillsCol.updateOne(
        { hub_id: hubId, skill_id: skillId },
        {
          $set: {
            ...(priorScanSummary !== undefined
              ? { scan_summary: priorScanSummary }
              : {}),
            scan_updated_at: now,
          },
          $unset: { scan_override: "" },
        },
      );

      await recordScanOverrideEvent({
        action: "clear",
        skill_id: skillId,
        skill_name: existing.name,
        source: "hub",
        hub_id: hubId,
        actor: user.email,
        reason,
        // The prior status is whatever the scanner had on file
        // (almost always "flagged"). The synthetic
        // "admin_overridden" string is no longer written by this
        // codebase.
        prior_scan_status: existing.scan_status ?? "flagged",
        prior_scan_summary: priorScanSummary,
      });

      const supervisorAuth = {
        accessToken: (session as { accessToken?: string } | null | undefined)
          ?.accessToken,
        catalogKey: request.headers.get("x-caipe-catalog-key") ?? undefined,
      };
      triggerSupervisorRefresh(supervisorAuth);

      return successResponse({
        id: `hub-${hubId}-${skillId}`,
        hub_id: hubId,
        skill_id: skillId,
        cleared: true,
        scan_status: existing.scan_status ?? "flagged",
        scan_updated_at: now.toISOString(),
      });
  },
);

export const dynamic = "force-dynamic";

// Same NextResponse trick as the agent_skills route — keeps the
// import warm for future per-method 405 handlers.
void NextResponse;
