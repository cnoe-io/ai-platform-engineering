import { NextRequest, NextResponse } from "next/server";
import { getCollection, isMongoDBConfigured } from "@/lib/mongodb";
import {
  withAuth,
  withErrorHandler,
  requireAdmin,
  ApiError,
  validateCredentialsRef,
} from "@/lib/api-middleware";

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
      const existing = await collection.findOne({ id });
      if (!existing) {
        throw new ApiError(`Hub not found: ${id}`, 404);
      }

      // Allow updating: enabled, location, credentials_ref
      const update: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };
      if (body.enabled !== undefined) update.enabled = !!body.enabled;
      if (body.location !== undefined) {
        let loc = String(body.location).trim();
        try {
          const url = new URL(loc);
          if (url.hostname.includes("github.com") || url.hostname.includes("gitlab.com")) {
            const segments = url.pathname.replace(/^\/+|\/+$/g, "").split("/");
            if (segments.length >= 2) loc = `${segments[0]}/${segments[1]}`;
          }
        } catch { /* not a URL */ }
        update.location = loc;
      }
      if (body.credentials_ref !== undefined)
        update.credentials_ref = validateCredentialsRef(body.credentials_ref);
      if (Array.isArray(body.labels))
        update.labels = body.labels.map((l: unknown) => String(l).trim().toLowerCase()).filter(Boolean).slice(0, 20);

      await collection.updateOne({ id }, { $set: update });

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

      return NextResponse.json(
        { success: true, message: `Hub ${id} deleted` },
        { status: 200 },
      );
    });
  },
);
