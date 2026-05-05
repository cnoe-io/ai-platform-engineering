import { NextRequest, NextResponse } from "next/server";
import { getCollection, isMongoDBConfigured } from "@/lib/mongodb";
import {
  withAuth,
  withErrorHandler,
  requireAdmin,
  ApiError,
  validateCredentialsRef,
} from "@/lib/api-middleware";
import {
  normalizeHubLocation,
  validateIncludePaths,
} from "../_lib/normalize";

/**
 * Skill Hubs API — Individual hub operations.
 *
 * PATCH  /api/skill-hubs/[id]  — Update a hub (admin only)
 * DELETE /api/skill-hubs/[id]  — Remove a hub (admin only)
 *
 * Per contracts/skill-hubs-api.md
 */

export const PATCH = withErrorHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    if (!isMongoDBConfigured) {
      throw new ApiError("Skill hubs require MongoDB to be configured", 503);
    }

    return await withAuth(request, async (_req, _user, session) => {
      requireAdmin(session);

      const { id } = await context.params;
      const body = await request.json();

      const collection = await getCollection("skill_hubs");
      const existing = await collection.findOne({ id }) as
        | { type?: "github" | "gitlab" }
        | null;
      if (!existing) {
        throw new ApiError(`Hub not found: ${id}`, 404);
      }

      // Allow updating: enabled, location, credentials_ref, labels, include_paths
      const update: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };
      const unset: Record<string, "" | 1> = {};
      if (body.enabled !== undefined) update.enabled = !!body.enabled;
      if (body.location !== undefined) {
        // Use the existing hub's `type` so a GitLab subgroup URL is
        // preserved end-to-end on PATCH (FR-022).
        update.location = normalizeHubLocation(
          String(body.location),
          existing.type ?? "github",
        );
      }
      if (body.credentials_ref !== undefined)
        update.credentials_ref = validateCredentialsRef(body.credentials_ref);
      if (Array.isArray(body.labels))
        update.labels = body.labels.map((l: unknown) => String(l).trim().toLowerCase()).filter(Boolean).slice(0, 20);
      if (body.include_paths !== undefined) {
        const validated = validateIncludePaths(body.include_paths);
        if (validated && validated.length > 0) {
          update.include_paths = validated;
        } else {
          // Empty array or fully-empty input is treated as "unset" so the
          // crawler reverts to "walk the whole repo" behavior.
          unset.include_paths = "";
        }
      }

      const writeOp: Record<string, unknown> = { $set: update };
      if (Object.keys(unset).length > 0) writeOp.$unset = unset;
      await collection.updateOne({ id }, writeOp);

      const updated = await collection.findOne({ id });
      const { _id, ...rest } = updated as any;

      return NextResponse.json(rest);
    });
  },
);

export const DELETE = withErrorHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    if (!isMongoDBConfigured) {
      throw new ApiError("Skill hubs require MongoDB to be configured", 503);
    }

    return await withAuth(request, async (_req, _user, session) => {
      requireAdmin(session);

      const { id } = await context.params;

      const collection = await getCollection("skill_hubs");
      const result = await collection.deleteOne({ id });
      if (result.deletedCount === 0) {
        throw new ApiError(`Hub not found: ${id}`, 404);
      }

      // Purge cached skills for this hub so they don't linger in the catalog.
      const hubSkillsCol = await getCollection("hub_skills");
      await hubSkillsCol.deleteMany({ hub_id: id });

      return NextResponse.json(
        { success: true, message: `Hub ${id} deleted` },
        { status: 200 },
      );
    });
  },
);
