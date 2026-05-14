/**
 * Per-target review config API.
 *
 *   GET /api/review-configs/{id}  — auth-only; returns the persisted
 *                                   document, upserting built-in defaults
 *                                   into Mongo on first read for known
 *                                   targets. Unknown targets 404.
 *   PUT /api/review-configs/{id}  — admin; partial update.
 *
 * The collection is self-initializing — there is no separate seed concept
 * and no DELETE endpoint. The set of valid target ids is fixed in the
 * code-side registry (see `lib/server/ai-review/defaults.ts`).
 */

import { NextRequest } from "next/server";
import { getCollection } from "@/lib/mongodb";
import {
  withAuth,
  withErrorHandler,
  successResponse,
  ApiError,
  requireAdmin,
} from "@/lib/api-middleware";
import type { ReviewConfig, ReviewCriterion } from "@/types/ai-review";
import { ensureConfig, getTargetMeta } from "@/lib/server/ai-review/defaults";

const COLLECTION_NAME = "review_configs";
const SLUG_RE = /^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/;

// ---------------------------------------------------------------------------
// Body validation — duplicated from the parent route module so there is no
// circular import. Kept tight; admin UI is the primary client.
// ---------------------------------------------------------------------------

function validateCriteria(value: unknown): ReviewCriterion[] {
  if (!Array.isArray(value)) {
    throw new ApiError("`criteria` must be an array", 400);
  }
  const seenIds = new Set<string>();
  return value.map((raw, idx) => {
    if (!raw || typeof raw !== "object") {
      throw new ApiError(`criteria[${idx}] must be an object`, 400);
    }
    const c = raw as Record<string, unknown>;
    const id = typeof c.id === "string" ? c.id.trim() : "";
    const name = typeof c.name === "string" ? c.name.trim() : "";
    const microPrompt =
      typeof c.micro_prompt === "string" ? c.micro_prompt : "";
    const severity = c.severity;
    if (!id) throw new ApiError(`criteria[${idx}].id is required`, 400);
    if (!SLUG_RE.test(id)) {
      throw new ApiError(
        `criteria[${idx}].id must be a slug (alphanumerics, dots, slashes, hyphens, underscores)`,
        400,
      );
    }
    if (seenIds.has(id)) {
      throw new ApiError(`criteria[${idx}].id "${id}" is duplicated`, 400);
    }
    seenIds.add(id);
    if (!name) throw new ApiError(`criteria[${idx}].name is required`, 400);
    if (!microPrompt.trim()) {
      throw new ApiError(`criteria[${idx}].micro_prompt is required`, 400);
    }
    if (severity !== "info" && severity !== "warning" && severity !== "error") {
      throw new ApiError(
        `criteria[${idx}].severity must be one of "info" | "warning" | "error"`,
        400,
      );
    }
    const weight =
      typeof c.weight === "number" && Number.isFinite(c.weight) && c.weight >= 0
        ? c.weight
        : 1;
    return {
      id,
      name,
      micro_prompt: microPrompt,
      severity,
      weight,
      expects_fix: c.expects_fix === true,
    } satisfies ReviewCriterion;
  });
}

function pickMutableFields(
  body: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  if (body.label !== undefined) {
    if (typeof body.label !== "string" || !body.label.trim()) {
      throw new ApiError("`label` must be a non-empty string", 400);
    }
    out.label = body.label.trim();
  }

  if (body.enabled !== undefined) {
    if (typeof body.enabled !== "boolean") {
      throw new ApiError("`enabled` must be a boolean", 400);
    }
    out.enabled = body.enabled;
  }

  if (body.enforcement !== undefined) {
    if (
      body.enforcement !== "blocking" &&
      body.enforcement !== "informational"
    ) {
      throw new ApiError(
        '`enforcement` must be "blocking" or "informational"',
        400,
      );
    }
    out.enforcement = body.enforcement;
  }

  if (body.min_score !== undefined) {
    if (
      typeof body.min_score !== "number" ||
      !Number.isFinite(body.min_score) ||
      body.min_score < 0 ||
      body.min_score > 1
    ) {
      throw new ApiError("`min_score` must be a number in [0, 1]", 400);
    }
    out.min_score = body.min_score;
  }

  if (body.grade_thresholds !== undefined) {
    const t = body.grade_thresholds;
    if (!t || typeof t !== "object") {
      throw new ApiError("`grade_thresholds` must be an object", 400);
    }
    const tt = t as Record<string, unknown>;
    const required = ["A", "B", "C", "D"] as const;
    const result: Record<string, number> = {};
    for (const key of required) {
      const v = tt[key];
      if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1) {
        throw new ApiError(
          `\`grade_thresholds.${key}\` must be a number in [0, 1]`,
          400,
        );
      }
      result[key] = v;
    }
    out.grade_thresholds = result;
  }

  if (body.model !== undefined) {
    if (body.model === null) {
      out.model = null;
    } else if (typeof body.model !== "object") {
      throw new ApiError("`model` must be an object or null", 400);
    } else {
      const m = body.model as Record<string, unknown>;
      out.model = {
        id: typeof m.id === "string" ? m.id : undefined,
        provider: typeof m.provider === "string" ? m.provider : undefined,
      };
    }
  }

  if (body.criteria !== undefined) {
    out.criteria = validateCriteria(body.criteria);
  }

  return out;
}

// ═══════════════════════════════════════════════════════════════
// GET — single config (auth; auto-seeds defaults on first read)
// ═══════════════════════════════════════════════════════════════

export const GET = withErrorHandler(
  async (
    request: NextRequest,
    context: { params: Promise<{ id: string }> },
  ) => {
    return await withAuth(request, async () => {
      const { id } = await context.params;
      const config = await ensureConfig(id);
      if (!config) {
        throw new ApiError(`Unknown review target '${id}'`, 404);
      }
      return successResponse(config);
    });
  },
);

// ═══════════════════════════════════════════════════════════════
// PUT — partial update (admin)
// ═══════════════════════════════════════════════════════════════

export const PUT = withErrorHandler(
  async (
    request: NextRequest,
    context: { params: Promise<{ id: string }> },
  ) => {
    return await withAuth(request, async (_req, user, session) => {
      requireAdmin(session);
      const { id } = await context.params;

      if (!getTargetMeta(id)) {
        throw new ApiError(`Unknown review target '${id}'`, 404);
      }

      const body = (await request.json()) as Record<string, unknown>;
      const updates = pickMutableFields(body);
      if (Object.keys(updates).length === 0) {
        throw new ApiError("No valid fields to update", 400);
      }

      const userEmail = user.email;
      const now = new Date().toISOString();

      // Make sure the row exists first (the editor may have loaded purely
      // from defaults if Mongo was briefly unavailable). ensureConfig is
      // idempotent — when the doc already exists it just reads it.
      await ensureConfig(id);

      const collection = await getCollection<ReviewConfig>(COLLECTION_NAME);

      const $set: Record<string, unknown> = { ...updates, updated_at: now };
      if (userEmail) $set.updated_by = userEmail;
      const $unset: Record<string, "" | 1> = {};
      if ($set.model === null) {
        delete $set.model;
        $unset.model = "";
      }

      const writeOp: Record<string, unknown> = { $set };
      if (Object.keys($unset).length > 0) writeOp.$unset = $unset;

      await collection.updateOne({ _id: id }, writeOp);
      const updated = await collection.findOne({ _id: id });
      return successResponse(updated);
    });
  },
);
