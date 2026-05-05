/**
 * Admin scan-override route.
 *
 * Lets a platform admin explicitly green-light a skill that the
 * security scanner has marked ``"flagged"``. The override stamps a
 * ``scan_override`` audit sub-doc on the skill (set_by/set_at/
 * reason/prior_scan_status) and writes a row to
 * ``skill_scan_override_history``. ``scan_status`` is intentionally
 * NOT touched — the scanner's verdict is preserved as-is.
 *
 * Why the override is a separate field instead of ``scan_status =
 * "admin_overridden"``: the previous design encoded the override
 * into the status string itself, which collided with every scanner
 * write path. Any rescan (per-skill, scan-all, hub auto-scan after
 * recrawl) would blindly write ``scan_status = "flagged"`` and
 * silently nuke the override. Splitting the signals lets scan
 * routes write status freely while the override stays stable until
 * an admin explicitly clears it.
 *
 * Two methods, mirror-image:
 *
 *   POST   ``/api/admin/skills/:source/:source_id/scan-override``
 *          — set an override. Requires ``reason`` in the body.
 *   DELETE ``/api/admin/skills/:source/:source_id/scan-override``
 *          — clear an override. Optional ``reason`` for the audit row.
 *
 * Both gates:
 *   - ``requireAdmin(session)`` (write action; 403 for non-admin)
 *   - ``ADMIN_SCAN_OVERRIDE_ENABLED !== "false"`` (env-flag escape
 *     hatch; 503 with a message pointing operators to the env var)
 *   - Mongo configured (503 if not — overrides only make sense for
 *     persisted skills)
 *
 * Why the route is admin-only via env, not group membership alone:
 * regulated environments need a way to remove the escape hatch
 * entirely. ``ADMIN_SCAN_OVERRIDE_ENABLED=false`` blocks writes here
 * AND makes the runtime gate ignore any existing ``scan_override``
 * sub-doc (Python ``scan_gate.is_skill_blocked`` and Node
 * ``applyRunnableGate``). Both tiers read the same env var.
 *
 * Why ``:source`` is in the URL even though only ``agent_skills`` is
 * supported today: future per-skill overrides for hub-sourced skills
 * (and possibly built-in template overrides) will live at the same
 * path with a different ``:source`` segment. Encoding it now means
 * the UI doesn't have to migrate URLs later. The handler explicitly
 * 400s for unsupported sources so the contract is unambiguous.
 *
 * assisted-by Cursor Composer-Sonnet-4.7
 */

import { NextRequest, NextResponse } from "next/server";
import {
  withAuth,
  withErrorHandler,
  successResponse,
  requireAdmin,
  ApiError,
} from "@/lib/api-middleware";
import { getCollection, isMongoDBConfigured } from "@/lib/mongodb";
import { recordScanOverrideEvent } from "@/lib/skill-scan-override-history";
import type { AgentSkill, ScanOverride } from "@/types/agent-skill";

const SUPERVISOR_URL = process.env.NEXT_PUBLIC_A2A_BASE_URL || "";

/**
 * Whether the admin override feature is on. Reads the same env var
 * as ``applyRunnableGate`` (Node) and ``scan_gate.is_admin_override_
 * enabled`` (Python). Permissive parsing: only explicit-false strings
 * disable it, so a typo can't silently disable the feature.
 *
 * Intentionally co-located with the other gate parsers (one in
 * applyRunnableGate, one here) instead of being centralised in a
 * shared module — both touchpoints are a single line and a shared
 * helper would create an import dance for marginal de-duplication.
 * If a third reader appears, refactor into ``@/lib/scan-override-flag``.
 */
function isAdminOverrideEnabled(): boolean {
  const raw = (process.env.ADMIN_SCAN_OVERRIDE_ENABLED ?? "true")
    .trim()
    .toLowerCase();
  return !["false", "0", "no", "off"].includes(raw);
}

/**
 * Validate and narrow the route's ``:source`` segment. v1 only
 * supports ``agent_skills`` overrides; hub and default sources will
 * follow with their own write paths.
 */
function assertSupportedSource(
  source: string,
): asserts source is "agent_skills" {
  if (source === "agent_skills") return;
  if (source === "default" || source === "hub") {
    throw new ApiError(
      `Scan-override is not supported for source "${source}" yet — ` +
        `only "agent_skills" skills can currently be overridden by an admin.`,
      400,
    );
  }
  throw new ApiError(
    `Unknown skill source "${source}" — expected one of "agent_skills", ` +
      `"default", "hub".`,
    400,
  );
}

/**
 * Background-fire a supervisor catalog refresh. The override changes
 * what the runtime is willing to serve, so the supervisor catalog
 * needs to re-pull. Same pattern as ``configs/[id]/scan/route.ts``;
 * see that file for the full rationale on auth forwarding.
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
    console.warn(
      "[ScanOverride] Background supervisor refresh failed:",
      err,
    );
  });
}

/**
 * POST — create or update an admin scan override.
 *
 * Body: ``{ reason: string }``. Reason is required and persisted
 * verbatim into the audit log (after a length cap to stop someone
 * pasting an entire scanner report into the doc).
 *
 * Preconditions:
 *   - Admin role (``requireAdmin``).
 *   - ``ADMIN_SCAN_OVERRIDE_ENABLED !== false``.
 *   - Mongo configured.
 *   - Skill exists in ``agent_skills``.
 *   - Skill's current ``scan_status`` is ``"flagged"``. Cannot
 *     override a passed/unscanned/already-overridden skill.
 *
 * On success returns the new ``scan_status`` + ``scan_override``
 * sub-doc so the UI can update the report dialog without an extra
 * GET.
 */
export const POST = withErrorHandler(
  async (
    request: NextRequest,
    context: { params: Promise<{ source: string; source_id: string }> },
  ) => {
    if (!isMongoDBConfigured) {
      throw new ApiError(
        "MongoDB is required for scan overrides (the admin escape hatch " +
          "writes audit metadata onto persisted agent_skills docs).",
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

    const { source, source_id } = await context.params;
    assertSupportedSource(source);
    if (!source_id) {
      throw new ApiError("Skill source_id is required in the URL.", 400);
    }

    return await withAuth(request, async (req, user, session) => {
      requireAdmin(session);

      // Body validation. We accept reason up to 4096 chars — long
      // enough for a paragraph, short enough that an accidental
      // paste of an entire scanner report doesn't bloat the doc /
      // audit row.
      let body: unknown;
      try {
        body = await req.json();
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

      const collection = await getCollection<AgentSkill>("agent_skills");
      const existing = await collection.findOne({ id: source_id });
      if (!existing) {
        throw new ApiError(
          `Agent skill "${source_id}" not found.`,
          404,
        );
      }
      // Hard-guard: only flagged skills are overridable. Passed /
      // unscanned skills don't need an override (they aren't
      // blocked); a skill that already carries an override must be
      // cleared first to avoid a "double override" with mismatched
      // reasons (and to preserve a clean audit chain — a single
      // override can't be silently re-stamped over the previous
      // admin's reason).
      if (existing.scan_status !== "flagged") {
        const current = existing.scan_status ?? "unscanned";
        throw new ApiError(
          `Cannot override a skill with scan_status="${current}". ` +
            `Only "flagged" skills can be overridden — passed and ` +
            `unscanned skills are not blocked.`,
          409,
        );
      }
      if (existing.scan_override) {
        throw new ApiError(
          `Skill "${source_id}" already has an active admin override ` +
            `(set by ${existing.scan_override.set_by} at ` +
            `${existing.scan_override.set_at}). Clear it first via ` +
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
      // This is the load-bearing change: the previous code wrote
      // ``scan_status = "admin_overridden"`` which collided with
      // every scanner write path (rescan, scan-all, hub auto-scan)
      // and silently nuked the override on the next scan.
      await collection.updateOne(
        { id: source_id },
        {
          $set: {
            scan_override: override,
            // Bump scan_updated_at so the gallery sort-by-recently-
            // scanned reflects the override action; the original
            // verdict's timestamp is recoverable from the history
            // collection if anyone cares.
            scan_updated_at: now,
            updated_at: now,
          },
        },
      );

      // Audit row first (before catalog refresh) so a refresh
      // failure can't lose the audit trail. Audit write is
      // best-effort by design (see recordScanOverrideEvent
      // docstring) — never blocks.
      await recordScanOverrideEvent({
        action: "set",
        skill_id: source_id,
        skill_name: existing.name,
        source: "agent_skills",
        actor: user.email,
        reason,
        prior_scan_status: "flagged",
        prior_scan_summary: existing.scan_summary,
      });

      const supervisorAuth = {
        accessToken: (session as { accessToken?: string } | null | undefined)
          ?.accessToken,
        catalogKey: req.headers.get("x-caipe-catalog-key") ?? undefined,
      };
      triggerSupervisorRefresh(supervisorAuth);

      return successResponse({
        id: source_id,
        // ``scan_status`` is unchanged ("flagged"); the override
        // sub-doc is what signals "runnable" to the gates. Returning
        // it here keeps the UI in sync without an extra GET.
        scan_status: existing.scan_status,
        scan_override: override,
        scan_updated_at: now.toISOString(),
      });
    });
  },
);

/**
 * DELETE — clear an existing admin override.
 *
 * Side effects: flips ``scan_status`` back to ``"flagged"`` (the
 * value the override originally rescued) and unsets the
 * ``scan_override`` sub-doc. The skill is once again blocked by the
 * scanner verdict, exactly as it was before the override.
 *
 * Body is optional. If a JSON body is provided we accept
 * ``reason`` (admin's note for the audit row); ignored if absent.
 *
 * Idempotent: clearing a skill that already has no override returns
 * 200 with a "no-op" body so a UI that double-fires the button
 * (slow network, retry) doesn't error.
 */
export const DELETE = withErrorHandler(
  async (
    request: NextRequest,
    context: { params: Promise<{ source: string; source_id: string }> },
  ) => {
    if (!isMongoDBConfigured) {
      throw new ApiError(
        "MongoDB is required for scan overrides.",
        503,
      );
    }
    // Note: clearing must work even when ADMIN_SCAN_OVERRIDE_ENABLED
    // is false. Operators flip the env to disable the feature, but
    // existing overrides should still be removable via the API
    // (otherwise stuck overrides accumulate that nobody can clean
    // up). The Node + Python gates already block-as-flagged when
    // the env is off, so leaving the override in place doesn't
    // serve any skill anyway — but admin hygiene wants the clear
    // path to remain open.

    const { source, source_id } = await context.params;
    assertSupportedSource(source);
    if (!source_id) {
      throw new ApiError("Skill source_id is required in the URL.", 400);
    }

    return await withAuth(request, async (req, user, session) => {
      requireAdmin(session);

      // Optional reason on clear. Tolerate "no body" and "body but
      // no reason field" cleanly.
      let reason: string | undefined;
      try {
        const ct = req.headers.get("content-type") ?? "";
        if (ct.includes("application/json")) {
          const body = (await req.json()) as { reason?: unknown };
          if (typeof body?.reason === "string") {
            const trimmed = body.reason.trim();
            if (trimmed.length > 0 && trimmed.length <= 4096) {
              reason = trimmed;
            }
          }
        }
      } catch {
        // Ignore parse errors on optional body.
      }

      const collection = await getCollection<AgentSkill>("agent_skills");
      const existing = await collection.findOne({ id: source_id });
      if (!existing) {
        throw new ApiError(
          `Agent skill "${source_id}" not found.`,
          404,
        );
      }

      if (!existing.scan_override) {
        // Idempotent no-op: nothing to clear. Return current state
        // so the UI can sync without a follow-up GET.
        return successResponse({
          id: source_id,
          cleared: false,
          scan_status: existing.scan_status ?? "unscanned",
        });
      }

      const now = new Date();
      const priorOverride = existing.scan_override;
      const priorScanSummary =
        priorOverride?.prior_scan_summary ?? existing.scan_summary;

      // Drop the override sub-doc only — ``scan_status`` is already
      // whatever the scanner last wrote (typically "flagged", which
      // is exactly what the override was rescuing). Restore
      // ``scan_summary`` from the snapshot captured at override
      // time so the UI's "why was this flagged?" panel doesn't go
      // blank if a later scanner write happened to overwrite it.
      // The UI will show the disabled "Disabled — flagged" badge
      // again immediately; admins can hit "Scan now" to re-evaluate.
      await collection.updateOne(
        { id: source_id },
        {
          $set: {
            ...(priorScanSummary !== undefined
              ? { scan_summary: priorScanSummary }
              : {}),
            scan_updated_at: now,
            updated_at: now,
          },
          $unset: { scan_override: "" },
        },
      );

      await recordScanOverrideEvent({
        action: "clear",
        skill_id: source_id,
        skill_name: existing.name,
        source: "agent_skills",
        actor: user.email,
        reason,
        // The prior status reported in the audit is whatever the
        // scanner had on file (almost always "flagged" since that's
        // the only state from which an override can be created).
        // We no longer report the synthetic "admin_overridden"
        // string — the override is now tracked on its own field,
        // so audit consumers should treat its presence/absence as
        // the override signal, not the status.
        prior_scan_status: existing.scan_status ?? "flagged",
        prior_scan_summary: priorScanSummary,
      });

      const supervisorAuth = {
        accessToken: (session as { accessToken?: string } | null | undefined)
          ?.accessToken,
        catalogKey: req.headers.get("x-caipe-catalog-key") ?? undefined,
      };
      triggerSupervisorRefresh(supervisorAuth);

      return successResponse({
        id: source_id,
        cleared: true,
        scan_status: existing.scan_status ?? "flagged",
        scan_updated_at: now.toISOString(),
      });
    });
  },
);

// Defense-in-depth: a route file that exports only POST + DELETE
// implicitly returns 405 for GET/PUT/PATCH via Next's default
// handler. We don't add custom 405s — Next's behaviour matches
// the rest of the admin namespace.
export const dynamic = "force-dynamic";

// Touch otherwise-unused NextResponse import to keep the symbol
// available for future per-method 405 handlers without re-importing
// (Next 16 sometimes treats unused imports as build warnings under
// the strictest configs). Negligible bundle impact since
// NextResponse is already eagerly imported by the framework.
void NextResponse;
