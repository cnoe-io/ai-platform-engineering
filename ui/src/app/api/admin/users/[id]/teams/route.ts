import { type NextRequest, NextResponse } from "next/server";
import { getCollection, isMongoDBConfigured } from "@/lib/mongodb";
import {
  withAuth,
  withErrorHandler,
  successResponse,
  requireAdmin,
  ApiError,
} from "@/lib/api-middleware";
import { getRealmUserById } from "@/lib/rbac/keycloak-admin";

function requireMongoDB(): NextResponse | null {
  if (!isMongoDBConfigured) {
    return NextResponse.json(
      {
        success: false,
        error: "MongoDB not configured — team membership requires MongoDB",
        code: "MONGODB_NOT_CONFIGURED",
      },
      { status: 503 }
    );
  }
  return null;
}

export const POST = withErrorHandler(
  async (
    request: NextRequest,
    context: { params: Promise<{ id: string }> }
  ) => {
    const mongoCheck = requireMongoDB();
    if (mongoCheck) return mongoCheck;

    return withAuth(request, async (req, _user, session) => {
      requireAdmin(session);
      const params = await context.params;
      const id = params.id;

      let body: { teamId?: string };
      try {
        body = (await req.json()) as { teamId?: string };
      } catch {
        throw new ApiError("Invalid JSON body", 400);
      }

      const teamId = typeof body.teamId === "string" ? body.teamId.trim() : "";
      if (!teamId) {
        throw new ApiError("teamId is required", 400);
      }

      const kcUser = await getRealmUserById(id);
      const email = String(kcUser.email ?? "").trim().toLowerCase();
      if (!email) {
        throw new ApiError("User has no email — cannot add to team membership list", 400);
      }

      const col = await getCollection<{ team_id: string; members?: string[] }>(
        "team_kb_ownership"
      );
      const now = new Date();
      const result = await col.updateOne(
        { team_id: teamId },
        {
          $addToSet: { members: email },
          $set: { updated_at: now },
        }
      );

      if (result.matchedCount === 0) {
        throw new ApiError("Team ownership record not found for teamId", 404);
      }

      return successResponse({ ok: true }, 200);
    });
  }
);

export const DELETE = withErrorHandler(
  async (
    request: NextRequest,
    context: { params: Promise<{ id: string }> }
  ) => {
    const mongoCheck = requireMongoDB();
    if (mongoCheck) return mongoCheck;

    return withAuth(request, async (req, _user, session) => {
      requireAdmin(session);
      const params = await context.params;
      const id = params.id;

      let body: { teamId?: string };
      try {
        body = (await req.json()) as { teamId?: string };
      } catch {
        throw new ApiError("Invalid JSON body", 400);
      }

      const teamId = typeof body.teamId === "string" ? body.teamId.trim() : "";
      if (!teamId) {
        throw new ApiError("teamId is required", 400);
      }

      const kcUser = await getRealmUserById(id);
      const email = String(kcUser.email ?? "").trim().toLowerCase();
      if (!email) {
        throw new ApiError("User has no email", 400);
      }

      const col = await getCollection<{ team_id: string; members?: string[] }>(
        "team_kb_ownership"
      );
      const updated = await col.updateOne(
        { team_id: teamId },
        {
          $pull: { members: email },
          $set: { updated_at: new Date() },
        }
      );

      if (updated.matchedCount === 0) {
        throw new ApiError("Team ownership record not found for teamId", 404);
      }

      return successResponse({ ok: true });
    });
  }
);
