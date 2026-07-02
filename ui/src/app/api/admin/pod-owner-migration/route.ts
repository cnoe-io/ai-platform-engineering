// GET/POST /api/admin/pod-owner-migration - Temporary owner backfill surface for pod meetings.

import { NextRequest, NextResponse } from "next/server";
import { getCollection, isMongoDBConfigured } from "@/lib/mongodb";
import {
  ApiError,
  requireAdmin,
  successResponse,
  withAuth,
  withErrorHandler,
} from "@/lib/api-middleware";
import {
  assignPodOwner,
  getPodOwnerMigrationState,
  isPodOwnerMigrationEnabled,
  type PodOwnerMigrationCollections,
} from "@/lib/pod-owner-migration";

export const dynamic = "force-dynamic";

function mongodbUnavailableResponse() {
  return NextResponse.json(
    {
      success: false,
      error: "MongoDB not configured - pod owner migration requires MongoDB",
      code: "MONGODB_NOT_CONFIGURED",
    },
    { status: 503 },
  );
}

function requireFeatureEnabled() {
  if (!isPodOwnerMigrationEnabled()) {
    throw new ApiError("Pod owner migration is disabled", 404, "FEATURE_DISABLED");
  }
}

async function collections(): Promise<PodOwnerMigrationCollections> {
  const [pods, users, schedules, conversations] = await Promise.all([
    getCollection("pods"),
    getCollection("users"),
    getCollection("schedules"),
    getCollection("conversations"),
  ]);

  return {
    pods: pods as unknown as PodOwnerMigrationCollections["pods"],
    users: users as unknown as PodOwnerMigrationCollections["users"],
    schedules: schedules as unknown as PodOwnerMigrationCollections["schedules"],
    conversations: conversations as unknown as PodOwnerMigrationCollections["conversations"],
  };
}

export const GET = withErrorHandler(async (request: NextRequest) => {
  requireFeatureEnabled();

  if (!isMongoDBConfigured) {
    return mongodbUnavailableResponse();
  }

  return withAuth(request, async (_req, _user, session) => {
    requireAdmin(session);
    return successResponse(await getPodOwnerMigrationState(await collections()));
  });
});

export const POST = withErrorHandler(async (request: NextRequest) => {
  requireFeatureEnabled();

  if (!isMongoDBConfigured) {
    return mongodbUnavailableResponse();
  }

  return withAuth(request, async (_req, user, session) => {
    requireAdmin(session);
    const body = await request.json().catch(() => ({}));
    const item = await assignPodOwner(await collections(), {
      pod_id: body?.pod_id,
      owner_user_id: body?.owner_user_id,
      migrated_by: user.email,
    });
    return successResponse({ pod: item });
  });
});
